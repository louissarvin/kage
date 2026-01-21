/**
 * ShadowVest Compressed Token Payroll Distribution
 *
 * Uses Light Protocol's ZK Compression to distribute payroll tokens
 * at 400x reduced cost compared to regular SPL token transfers.
 *
 * Key features:
 * - Rent-free token accounts for recipients
 * - Batch distribution (5 recipients per instruction)
 * - ~120,000 compute units per recipient
 * - Recipients can decompress to regular SPL tokens anytime
 *
 * @see https://www.zkcompression.com/compressed-tokens/overview
 * @see https://www.zkcompression.com/compressed-tokens/advanced-guides/airdrop
 */

import {
  Rpc,
  createRpc,
  bn,
  selectStateTreeInfo,
  LightSystemProgram,
  buildAndSignTx,
  sendAndConfirmTx,
} from "@lightprotocol/stateless.js";
import {
  CompressedTokenProgram,
  selectTokenPoolInfo,
  getTokenPoolInfos,
} from "@lightprotocol/compressed-token";
import {
  Connection,
  PublicKey,
  Keypair,
  TransactionInstruction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ============================================================================
// Types
// ============================================================================

/**
 * Individual payroll recipient
 */
export interface PayrollRecipient {
  /** Recipient's wallet address */
  address: PublicKey;
  /** Amount to distribute (in token base units) */
  amount: bigint;
  /** Optional identifier for tracking (e.g., employee ID) */
  identifier?: string;
}

/**
 * Payroll distribution configuration
 */
export interface PayrollConfig {
  /** Token mint address */
  mint: PublicKey;
  /** List of recipients with amounts */
  recipients: PayrollRecipient[];
  /** Recipients per compression instruction (default: 5) */
  batchSize?: number;
  /** Compute units per recipient (default: 120,000) */
  computeUnitsPerRecipient?: number;
  /** Max retry attempts for failed batches (default: 3) */
  maxRetries?: number;
  /** Priority fee in microlamports (default: 1000) */
  priorityFee?: number;
}

/**
 * Result of a single batch distribution
 */
export interface BatchResult {
  /** Transaction signature */
  signature: string;
  /** Recipients in this batch */
  recipients: PayrollRecipient[];
  /** Whether the batch succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Overall distribution result
 */
export interface DistributionResult {
  /** Total recipients processed successfully */
  successful: number;
  /** Total recipients that failed */
  failed: number;
  /** Total amount distributed */
  totalAmount: bigint;
  /** Individual batch results */
  batches: BatchResult[];
  /** Overall execution time in ms */
  executionTimeMs: number;
}

/**
 * Decompression result
 */
export interface DecompressResult {
  /** Transaction signature */
  signature: string;
  /** Amount decompressed */
  amount: bigint;
  /** Destination SPL token account */
  destinationAccount: PublicKey;
}

// ============================================================================
// Constants
// ============================================================================

/** Default batch size (recipients per instruction) */
const DEFAULT_BATCH_SIZE = 5;

/** Default compute units per recipient */
const DEFAULT_COMPUTE_UNITS_PER_RECIPIENT = 120_000;

/** Max compute units per transaction */
const MAX_COMPUTE_UNITS = 1_400_000;

/** Default max retries for failed batches */
const DEFAULT_MAX_RETRIES = 3;

/** Default priority fee in microlamports */
const DEFAULT_PRIORITY_FEE = 1000;

// ============================================================================
// Main Distribution Function
// ============================================================================

/**
 * Distribute payroll using compressed tokens
 *
 * @param rpcEndpoint - Solana RPC endpoint (must support ZK Compression)
 * @param payer - Keypair of the payer/employer
 * @param config - Payroll distribution configuration
 * @returns Distribution result with success/failure counts
 *
 * @example
 * ```typescript
 * const result = await distributePayroll(
 *   "https://devnet.helius-rpc.com/?api-key=YOUR_KEY",
 *   payerKeypair,
 *   {
 *     mint: new PublicKey("..."),
 *     recipients: [
 *       { address: new PublicKey("..."), amount: 1000000n },
 *       { address: new PublicKey("..."), amount: 2000000n },
 *     ],
 *   }
 * );
 * console.log(`Distributed to ${result.successful} recipients`);
 * ```
 */
export async function distributePayroll(
  rpcEndpoint: string,
  payer: Keypair,
  config: PayrollConfig
): Promise<DistributionResult> {
  const startTime = Date.now();
  const {
    mint,
    recipients,
    batchSize = DEFAULT_BATCH_SIZE,
    computeUnitsPerRecipient = DEFAULT_COMPUTE_UNITS_PER_RECIPIENT,
    maxRetries = DEFAULT_MAX_RETRIES,
    priorityFee = DEFAULT_PRIORITY_FEE,
  } = config;

  // Initialize RPC connection with ZK Compression support
  const connection = createRpc(rpcEndpoint, rpcEndpoint);

  // Get Light Protocol infrastructure info
  const stateTreeInfos = await connection.getStateTreeInfos();
  const tokenPoolInfos = await getTokenPoolInfos(connection, mint);

  if (tokenPoolInfos.length === 0) {
    throw new Error(
      `No token pool found for mint ${mint.toBase58()}. ` +
        `Make sure the mint has been registered with Light Protocol.`
    );
  }

  // Split recipients into batches
  const batches = chunkArray(recipients, batchSize);
  const results: BatchResult[] = [];
  let successful = 0;
  let failed = 0;
  let totalAmount = BigInt(0);

  console.log(`Starting payroll distribution:`);
  console.log(`  - Total recipients: ${recipients.length}`);
  console.log(`  - Batches: ${batches.length}`);
  console.log(`  - Batch size: ${batchSize}`);
  console.log(`  - Mint: ${mint.toBase58()}`);

  // Process each batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchAmount = batch.reduce((sum, r) => sum + r.amount, BigInt(0));

    console.log(
      `\nProcessing batch ${i + 1}/${batches.length} (${batch.length} recipients, ${batchAmount} tokens)...`
    );

    let attempts = 0;
    let success = false;
    let signature = "";
    let error = "";

    while (attempts < maxRetries && !success) {
      attempts++;
      try {
        // Select infrastructure for this batch
        const stateTreeInfo = selectStateTreeInfo(stateTreeInfos);
        const tokenPoolInfo = selectTokenPoolInfo(tokenPoolInfos);

        // Build compression instructions for the batch
        const compressIxs = await buildCompressInstructions(
          connection,
          payer.publicKey,
          mint,
          batch,
          stateTreeInfo,
          tokenPoolInfo
        );

        // Add compute budget instructions
        const computeUnits = Math.min(
          batch.length * computeUnitsPerRecipient,
          MAX_COMPUTE_UNITS
        );
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
          units: computeUnits,
        });
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: priorityFee,
        });

        // Build and sign transaction
        const { blockhash } = await connection.getLatestBlockhash();
        const tx = buildAndSignTx(
          [computeBudgetIx, priorityFeeIx, ...compressIxs],
          payer,
          blockhash
        );

        // Send and confirm
        signature = await sendAndConfirmTx(connection, tx);
        success = true;

        console.log(`  Batch ${i + 1} succeeded: ${signature}`);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.log(
          `  Batch ${i + 1} attempt ${attempts} failed: ${error.slice(0, 100)}...`
        );

        if (attempts < maxRetries) {
          // Wait before retry with exponential backoff
          await sleep(1000 * Math.pow(2, attempts));
        }
      }
    }

    // Record batch result
    results.push({
      signature,
      recipients: batch,
      success,
      error: success ? undefined : error,
    });

    if (success) {
      successful += batch.length;
      totalAmount += batchAmount;
    } else {
      failed += batch.length;
    }
  }

  const executionTimeMs = Date.now() - startTime;

  console.log(`\nDistribution complete:`);
  console.log(`  - Successful: ${successful}`);
  console.log(`  - Failed: ${failed}`);
  console.log(`  - Total amount: ${totalAmount}`);
  console.log(`  - Execution time: ${executionTimeMs}ms`);

  return {
    successful,
    failed,
    totalAmount,
    batches: results,
    executionTimeMs,
  };
}

// ============================================================================
// Decompression Function
// ============================================================================

/**
 * Decompress tokens from compressed format to regular SPL tokens
 *
 * This allows recipients to convert their compressed tokens back to
 * standard SPL tokens that can be used with any Solana application.
 *
 * @param rpcEndpoint - Solana RPC endpoint (must support ZK Compression)
 * @param owner - Keypair of the token owner
 * @param mint - Token mint address
 * @param amount - Amount to decompress (in token base units)
 * @returns Decompression result with transaction signature
 *
 * @example
 * ```typescript
 * const result = await decompressTokens(
 *   "https://devnet.helius-rpc.com/?api-key=YOUR_KEY",
 *   ownerKeypair,
 *   mintAddress,
 *   1000000n
 * );
 * console.log(`Decompressed to ${result.destinationAccount.toBase58()}`);
 * ```
 */
export async function decompressTokens(
  rpcEndpoint: string,
  owner: Keypair,
  mint: PublicKey,
  amount: bigint
): Promise<DecompressResult> {
  const connection = createRpc(rpcEndpoint, rpcEndpoint);

  // Get compressed token accounts for the owner
  const compressedAccounts = await connection.getCompressedTokenAccountsByOwner(
    owner.publicKey,
    { mint }
  );

  if (compressedAccounts.items.length === 0) {
    throw new Error(
      `No compressed token accounts found for owner ${owner.publicKey.toBase58()}`
    );
  }

  // Calculate total compressed balance
  const totalBalance = compressedAccounts.items.reduce(
    (sum, acc) => sum + BigInt(acc.parsed.amount.toString()),
    BigInt(0)
  );

  if (totalBalance < amount) {
    throw new Error(
      `Insufficient compressed balance: ${totalBalance} < ${amount}`
    );
  }

  // Get or create the destination SPL token account
  const destinationAccount = await getAssociatedTokenAddress(
    mint,
    owner.publicKey
  );

  // Check if destination account exists, create if not
  const accountInfo = await connection.getAccountInfo(destinationAccount);
  const preInstructions: TransactionInstruction[] = [];

  if (!accountInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        owner.publicKey,
        destinationAccount,
        owner.publicKey,
        mint
      )
    );
  }

  // Get the first compressed account for decompression
  const inputAccount = compressedAccounts.items[0];

  // Get token pool infos for decompression
  const tokenPoolInfos = await getTokenPoolInfos(connection, mint);
  if (tokenPoolInfos.length === 0) {
    throw new Error(`No token pool found for mint ${mint.toBase58()}`);
  }

  // Build decompress instruction using the SDK's interface
  // Note: The exact API may vary based on SDK version - this follows the documented pattern
  const decompressIx = await CompressedTokenProgram.decompress({
    payer: owner.publicKey,
    inputCompressedTokenAccounts: [inputAccount],
    toAddress: destinationAccount,
    amount: bn(amount.toString()),
    recentInputStateRootIndices: [(inputAccount as any).rootIndex || 0],
    recentValidityProof: null as any, // Will be fetched by SDK
    tokenPoolInfos: tokenPoolInfos,
  } as any);

  // Build and sign transaction
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = buildAndSignTx(
    [...preInstructions, decompressIx],
    owner,
    blockhash
  );

  // Send and confirm
  const signature = await sendAndConfirmTx(connection, tx);

  console.log(`Decompressed ${amount} tokens to ${destinationAccount.toBase58()}`);
  console.log(`Signature: ${signature}`);

  return {
    signature,
    amount,
    destinationAccount,
  };
}

// ============================================================================
// Balance Checking Functions
// ============================================================================

/**
 * Get compressed token balance for an address
 *
 * @param rpcEndpoint - Solana RPC endpoint
 * @param owner - Owner's public key
 * @param mint - Token mint address
 * @returns Total compressed token balance
 */
export async function getCompressedBalance(
  rpcEndpoint: string,
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  const connection = createRpc(rpcEndpoint, rpcEndpoint);

  const accounts = await connection.getCompressedTokenAccountsByOwner(owner, {
    mint,
  });

  return accounts.items.reduce(
    (sum, acc) => sum + BigInt(acc.parsed.amount.toString()),
    BigInt(0)
  );
}

/**
 * Get compressed token balances for multiple addresses
 *
 * @param rpcEndpoint - Solana RPC endpoint
 * @param owners - List of owner public keys
 * @param mint - Token mint address
 * @returns Map of owner address to balance
 */
export async function getCompressedBalances(
  rpcEndpoint: string,
  owners: PublicKey[],
  mint: PublicKey
): Promise<Map<string, bigint>> {
  const connection = createRpc(rpcEndpoint, rpcEndpoint);
  const balances = new Map<string, bigint>();

  // Fetch balances in parallel with rate limiting
  const BATCH_SIZE = 10;
  for (let i = 0; i < owners.length; i += BATCH_SIZE) {
    const batch = owners.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (owner) => {
        try {
          const accounts = await connection.getCompressedTokenAccountsByOwner(
            owner,
            { mint }
          );
          const balance = accounts.items.reduce(
            (sum, acc) => sum + BigInt(acc.parsed.amount.toString()),
            BigInt(0)
          );
          return { owner: owner.toBase58(), balance };
        } catch {
          return { owner: owner.toBase58(), balance: BigInt(0) };
        }
      })
    );

    for (const { owner, balance } of results) {
      balances.set(owner, balance);
    }
  }

  return balances;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build compression instructions for a batch of recipients
 */
async function buildCompressInstructions(
  connection: Rpc,
  payer: PublicKey,
  mint: PublicKey,
  recipients: PayrollRecipient[],
  stateTreeInfo: any,
  tokenPoolInfo: any
): Promise<TransactionInstruction[]> {
  const instructions: TransactionInstruction[] = [];

  // Build a compress instruction for each recipient
  // Note: The exact API may vary based on SDK version
  for (const recipient of recipients) {
    const ix = await CompressedTokenProgram.compress({
      payer,
      owner: payer,
      source: await getAssociatedTokenAddress(mint, payer),
      toAddress: recipient.address,
      amount: bn(recipient.amount.toString()),
      mint,
      outputStateTreeInfo: stateTreeInfo,
      tokenPoolInfo: tokenPoolInfo,
    });

    instructions.push(ix);
  }

  return instructions;
}

/**
 * Split an array into chunks of specified size
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Estimate the cost of distributing to recipients
 *
 * @param recipientCount - Number of recipients
 * @param priorityFee - Priority fee in microlamports (default: 1000)
 * @returns Estimated cost in lamports and SOL
 */
export function estimateDistributionCost(
  recipientCount: number,
  priorityFee: number = DEFAULT_PRIORITY_FEE
): { lamports: number; sol: number; comparedToSpl: string } {
  // Compressed token cost: ~5,000 lamports per recipient
  const compressedCostPerRecipient = 5_000;

  // SPL token account cost: ~2,000,000 lamports (rent exempt)
  const splCostPerRecipient = 2_039_280;

  // Calculate costs
  const compressedTotal = recipientCount * compressedCostPerRecipient;
  const splTotal = recipientCount * splCostPerRecipient;
  const savings = splTotal - compressedTotal;

  return {
    lamports: compressedTotal,
    sol: compressedTotal / LAMPORTS_PER_SOL,
    comparedToSpl: `${Math.round(splTotal / compressedTotal)}x cheaper than SPL (saves ${(savings / LAMPORTS_PER_SOL).toFixed(4)} SOL)`,
  };
}

// ============================================================================
// CLI Entry Point (for direct execution)
// ============================================================================

/**
 * Example usage when run directly
 */
async function main() {
  console.log("ShadowVest Compressed Token Payroll Distribution");
  console.log("================================================\n");

  // Example cost estimation
  const estimate = estimateDistributionCost(1000);
  console.log("Cost estimate for 1,000 recipients:");
  console.log(`  - Compressed: ${estimate.lamports} lamports (${estimate.sol} SOL)`);
  console.log(`  - ${estimate.comparedToSpl}`);
  console.log("\n");

  console.log("To use this library, import and call distributePayroll():");
  console.log(`
  import { distributePayroll } from './lib/compressed-payroll';

  const result = await distributePayroll(
    "https://devnet.helius-rpc.com/?api-key=YOUR_KEY",
    payerKeypair,
    {
      mint: new PublicKey("YOUR_MINT"),
      recipients: [
        { address: new PublicKey("EMPLOYEE_1"), amount: 1000000n },
        { address: new PublicKey("EMPLOYEE_2"), amount: 2000000n },
      ],
    }
  );
  `);
}

// Run main if executed directly
if (require.main === module) {
  main().catch(console.error);
}
