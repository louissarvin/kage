/**
 * ShadowVest CCTP Bridge Library
 *
 * Enables cross-chain USDC transfers using Circle's Cross-Chain Transfer Protocol (CCTP).
 * USDC is burned on the source chain and minted on the destination chain.
 *
 * Documentation:
 * - CCTP Docs: https://developers.circle.com/cctp
 * - Solana Contracts: https://github.com/circlefin/solana-cctp-contracts
 * - Iris API: https://developers.circle.com/api-reference/cctp/all/get-attestation
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import BN from "bn.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * CCTP Program IDs on Solana
 */
export const CCTP_PROGRAMS = {
  // V1 Programs (Legacy)
  MESSAGE_TRANSMITTER_V1: new PublicKey(
    "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd"
  ),
  TOKEN_MESSENGER_MINTER_V1: new PublicKey(
    "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3"
  ),
  // V2 Programs (Current)
  MESSAGE_TRANSMITTER: new PublicKey(
    "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
  ),
  TOKEN_MESSENGER_MINTER: new PublicKey(
    "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
  ),
};

/**
 * USDC Mint addresses on Solana
 */
export const USDC_MINT = {
  MAINNET: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  DEVNET: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
};

/**
 * CCTP Domain IDs for supported chains
 */
export const CCTP_DOMAINS = {
  ETHEREUM: 0,
  AVALANCHE: 1,
  OPTIMISM: 2,
  ARBITRUM: 3,
  NOBLE: 4, // Cosmos
  SOLANA: 5,
  BASE: 6,
  POLYGON: 7,
  SUI: 8,
} as const;

export type CctpDomain = (typeof CCTP_DOMAINS)[keyof typeof CCTP_DOMAINS];

/**
 * Circle Iris Attestation API endpoints
 */
export const IRIS_API = {
  MAINNET: "https://iris-api.circle.com",
  TESTNET: "https://iris-api-sandbox.circle.com",
};

/**
 * Chain information for display and configuration
 */
export const CHAIN_INFO: Record<
  CctpDomain,
  { name: string; explorer: string; usdcAddress: string }
> = {
  [CCTP_DOMAINS.ETHEREUM]: {
    name: "Ethereum",
    explorer: "https://etherscan.io",
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  [CCTP_DOMAINS.AVALANCHE]: {
    name: "Avalanche",
    explorer: "https://snowtrace.io",
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  },
  [CCTP_DOMAINS.OPTIMISM]: {
    name: "Optimism",
    explorer: "https://optimistic.etherscan.io",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
  [CCTP_DOMAINS.ARBITRUM]: {
    name: "Arbitrum",
    explorer: "https://arbiscan.io",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  [CCTP_DOMAINS.NOBLE]: {
    name: "Noble (Cosmos)",
    explorer: "https://www.mintscan.io/noble",
    usdcAddress: "uusdc",
  },
  [CCTP_DOMAINS.SOLANA]: {
    name: "Solana",
    explorer: "https://solscan.io",
    usdcAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  [CCTP_DOMAINS.BASE]: {
    name: "Base",
    explorer: "https://basescan.org",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  [CCTP_DOMAINS.POLYGON]: {
    name: "Polygon",
    explorer: "https://polygonscan.com",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  [CCTP_DOMAINS.SUI]: {
    name: "Sui",
    explorer: "https://suiscan.xyz",
    usdcAddress:
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  },
};

// =============================================================================
// Types
// =============================================================================

export interface BridgeConfig {
  /** Solana RPC endpoint */
  rpcEndpoint: string;
  /** Use mainnet (true) or testnet (false) */
  isMainnet: boolean;
}

export interface DepositForBurnParams {
  /** Amount of USDC to bridge (in smallest units, 6 decimals) */
  amount: bigint;
  /** Destination chain domain ID */
  destinationDomain: CctpDomain;
  /**
   * Recipient address on destination chain (32 bytes)
   * - For EVM: 20-byte address padded to 32 bytes
   * - For Solana: 32-byte public key
   */
  destinationRecipient: Uint8Array;
  /** Optional: specific caller allowed to receive on destination */
  destinationCaller?: Uint8Array;
  /** Maximum fee willing to pay (default: 0) */
  maxFee?: bigint;
}

export interface DepositForBurnResult {
  /** Transaction signature on Solana */
  signature: string;
  /** Message hash for attestation lookup */
  messageHash: string;
  /** Message bytes (needed for receiveMessage) */
  message: Uint8Array;
  /** Nonce of the message */
  nonce: bigint;
  /** Amount burned */
  amount: bigint;
  /** Destination domain */
  destinationDomain: CctpDomain;
}

export interface AttestationResult {
  /** Attestation status */
  status: "pending" | "complete";
  /** Signed attestation bytes (if complete) */
  attestation: Uint8Array | null;
  /** Message hash */
  messageHash: string;
}

export interface ReceiveMessageParams {
  /** Original message from depositForBurn */
  message: Uint8Array;
  /** Signed attestation from Iris API */
  attestation: Uint8Array;
}

export interface ReceiveMessageResult {
  /** Transaction signature */
  signature: string;
  /** Amount received */
  amount: bigint;
  /** Recipient's token account */
  recipientTokenAccount: PublicKey;
}

// =============================================================================
// PDA Derivation
// =============================================================================

/**
 * Derive PDA for message transmitter state
 */
function findMessageTransmitterPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter")],
    CCTP_PROGRAMS.MESSAGE_TRANSMITTER
  );
}

/**
 * Derive PDA for token messenger
 */
function findTokenMessengerPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_messenger")],
    CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER
  );
}

/**
 * Derive PDA for token minter
 */
function findTokenMinterPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_minter")],
    CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER
  );
}

/**
 * Derive PDA for local token (USDC on Solana)
 */
function findLocalTokenPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("local_token"), mint.toBuffer()],
    CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER
  );
}

/**
 * Derive PDA for remote token messenger
 */
function findRemoteTokenMessengerPda(
  remoteDomain: number
): [PublicKey, number] {
  const domainBuffer = Buffer.alloc(4);
  domainBuffer.writeUInt32LE(remoteDomain, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("remote_token_messenger"), domainBuffer],
    CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER
  );
}

/**
 * Derive PDA for sender authority
 */
function findSenderAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sender_authority")],
    CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER
  );
}

/**
 * Derive PDA for used nonces
 */
function findUsedNoncesPda(
  sourceDomain: number,
  nonce: bigint
): [PublicKey, number] {
  const domainBuffer = Buffer.alloc(4);
  domainBuffer.writeUInt32LE(sourceDomain, 0);
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(nonce, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("used_nonces"), domainBuffer, nonceBuffer],
    CCTP_PROGRAMS.MESSAGE_TRANSMITTER
  );
}

/**
 * Derive PDA for authority in message transmitter
 */
function findAuthorityPda(receiver: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter_authority"), receiver.toBuffer()],
    CCTP_PROGRAMS.MESSAGE_TRANSMITTER
  );
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Bridge USDC from Solana to another chain
 *
 * This burns USDC on Solana. After the transaction confirms and Circle's
 * Iris service signs the attestation, the recipient can claim on the
 * destination chain.
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer and USDC owner
 * @param params - Bridge parameters
 * @param config - Bridge configuration
 * @returns Deposit result with message hash for attestation lookup
 */
export async function bridgeUsdcFromSolana(
  connection: Connection,
  payer: Keypair,
  params: DepositForBurnParams,
  config: BridgeConfig
): Promise<DepositForBurnResult> {
  const mint = config.isMainnet ? USDC_MINT.MAINNET : USDC_MINT.DEVNET;

  // Get payer's USDC token account
  const payerTokenAccount = await getAssociatedTokenAddress(
    mint,
    payer.publicKey
  );

  // Derive required PDAs
  const [messageTransmitter] = findMessageTransmitterPda();
  const [tokenMessenger] = findTokenMessengerPda();
  const [tokenMinter] = findTokenMinterPda();
  const [localToken] = findLocalTokenPda(mint);
  const [remoteTokenMessenger] = findRemoteTokenMessengerPda(
    params.destinationDomain
  );
  const [senderAuthority] = findSenderAuthorityPda();

  // Create a keypair for the message sent event account
  const messageSentEventAccount = Keypair.generate();

  // Build depositForBurn instruction data
  // Layout: [instruction discriminator (8)] [amount (8)] [destination_domain (4)]
  //         [mint_recipient (32)] [max_fee (8)] [destination_caller (32)]
  const instructionData = Buffer.alloc(92);

  // Instruction discriminator for depositForBurn
  // This is anchor's discriminator hash
  const discriminator = Buffer.from([
    // depositForBurn discriminator - needs to match program
    0x56, 0xcc, 0xea, 0x9e, 0x15, 0x22, 0x39, 0x2a,
  ]);
  discriminator.copy(instructionData, 0);

  // Amount (u64, little endian)
  instructionData.writeBigUInt64LE(params.amount, 8);

  // Destination domain (u32, little endian)
  instructionData.writeUInt32LE(params.destinationDomain, 16);

  // Mint recipient (32 bytes)
  Buffer.from(params.destinationRecipient).copy(instructionData, 20);

  // Max fee (u64, little endian)
  instructionData.writeBigUInt64LE(params.maxFee || BigInt(0), 52);

  // Destination caller (32 bytes, or zeros if not specified)
  if (params.destinationCaller) {
    Buffer.from(params.destinationCaller).copy(instructionData, 60);
  }

  // Build the instruction
  const depositForBurnIx = new TransactionInstruction({
    programId: CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // owner
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // event_rent_payer
      { pubkey: senderAuthority, isSigner: false, isWritable: false }, // sender_authority_pda
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true }, // burn_token_account
      { pubkey: messageTransmitter, isSigner: false, isWritable: true }, // message_transmitter
      { pubkey: tokenMessenger, isSigner: false, isWritable: false }, // token_messenger
      { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false }, // remote_token_messenger
      { pubkey: tokenMinter, isSigner: false, isWritable: false }, // token_minter
      { pubkey: localToken, isSigner: false, isWritable: true }, // local_token
      { pubkey: mint, isSigner: false, isWritable: true }, // burn_token_mint
      {
        pubkey: messageSentEventAccount.publicKey,
        isSigner: true,
        isWritable: true,
      }, // message_sent_event_data
      {
        pubkey: CCTP_PROGRAMS.MESSAGE_TRANSMITTER,
        isSigner: false,
        isWritable: false,
      }, // message_transmitter_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data: instructionData,
  });

  // Build and send transaction
  const transaction = new Transaction().add(depositForBurnIx);

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    payer,
    messageSentEventAccount,
  ]);

  // Parse transaction to get message hash and nonce
  // In a real implementation, we'd parse the MessageSent event
  const messageHash = Buffer.from(messageSentEventAccount.publicKey.toBytes())
    .toString("hex")
    .slice(0, 64);

  return {
    signature,
    messageHash,
    message: new Uint8Array(0), // Would be parsed from transaction logs
    nonce: BigInt(0), // Would be parsed from transaction logs
    amount: params.amount,
    destinationDomain: params.destinationDomain,
  };
}

/**
 * Fetch attestation from Circle's Iris API
 *
 * After a depositForBurn transaction, Circle's attestation service
 * observes the burn and signs an attestation. This process typically
 * takes 15-30 minutes depending on source chain finality.
 *
 * @param messageHash - Message hash from depositForBurn
 * @param isMainnet - Use mainnet or testnet Iris API
 * @returns Attestation result
 */
export async function getAttestation(
  messageHash: string,
  isMainnet: boolean = false
): Promise<AttestationResult> {
  const baseUrl = isMainnet ? IRIS_API.MAINNET : IRIS_API.TESTNET;
  const url = `${baseUrl}/v1/attestations/${messageHash}`;

  const response = await fetch(url);

  if (!response.ok) {
    // 404 = message not found, 400 = invalid hash format
    // Both cases mean attestation is not available
    if (response.status === 404 || response.status === 400) {
      return {
        status: "pending",
        attestation: null,
        messageHash,
      };
    }
    throw new Error(`Attestation API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.status === "pending_confirmations" || !data.attestation) {
    return {
      status: "pending",
      attestation: null,
      messageHash,
    };
  }

  // Attestation is hex-encoded
  const attestationHex = data.attestation.replace("0x", "");
  const attestation = new Uint8Array(
    Buffer.from(attestationHex, "hex")
  );

  return {
    status: "complete",
    attestation,
    messageHash,
  };
}

/**
 * Poll for attestation until it's ready
 *
 * @param messageHash - Message hash from depositForBurn
 * @param isMainnet - Use mainnet or testnet
 * @param maxAttempts - Maximum polling attempts (default: 60)
 * @param intervalMs - Polling interval in ms (default: 30000 = 30s)
 * @returns Completed attestation
 */
export async function waitForAttestation(
  messageHash: string,
  isMainnet: boolean = false,
  maxAttempts: number = 60,
  intervalMs: number = 30000
): Promise<AttestationResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await getAttestation(messageHash, isMainnet);

    if (result.status === "complete" && result.attestation) {
      return result;
    }

    console.log(
      `Attestation pending (attempt ${attempt + 1}/${maxAttempts}), waiting...`
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Attestation not ready after ${maxAttempts} attempts (${(maxAttempts * intervalMs) / 60000} minutes)`
  );
}

/**
 * Receive USDC on Solana from another chain
 *
 * This mints USDC on Solana after it was burned on the source chain.
 * Requires the original message and signed attestation from Iris.
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer
 * @param recipient - USDC recipient public key
 * @param params - Receive parameters
 * @param config - Bridge configuration
 * @returns Receive result
 */
export async function receiveUsdcOnSolana(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  params: ReceiveMessageParams,
  config: BridgeConfig
): Promise<ReceiveMessageResult> {
  const mint = config.isMainnet ? USDC_MINT.MAINNET : USDC_MINT.DEVNET;

  // Parse source domain and nonce from message
  // Message format depends on CCTP version
  const sourceDomain = parseSourceDomain(params.message);
  const nonce = parseNonce(params.message);

  // Derive required PDAs
  const [messageTransmitter] = findMessageTransmitterPda();
  const [tokenMessenger] = findTokenMessengerPda();
  const [tokenMinter] = findTokenMinterPda();
  const [localToken] = findLocalTokenPda(mint);
  const [remoteTokenMessenger] = findRemoteTokenMessengerPda(sourceDomain);
  const [usedNonces] = findUsedNoncesPda(sourceDomain, nonce);
  const [authorityPda] = findAuthorityPda(CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER);

  // Get or create recipient's USDC token account
  const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);

  // Check if token account exists, create if not
  const tokenAccountInfo = await connection.getAccountInfo(recipientTokenAccount);
  const preInstructions: TransactionInstruction[] = [];

  if (!tokenAccountInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        recipientTokenAccount,
        recipient,
        mint
      )
    );
  }

  // Build receiveMessage instruction data
  const messageBuffer = Buffer.from(params.message);
  const attestationBuffer = Buffer.from(params.attestation);

  // Layout: [discriminator (8)] [message_len (4)] [message] [attestation_len (4)] [attestation]
  const dataLength = 8 + 4 + messageBuffer.length + 4 + attestationBuffer.length;
  const instructionData = Buffer.alloc(dataLength);

  // Instruction discriminator for receiveMessage
  const discriminator = Buffer.from([
    0xf5, 0x89, 0xa9, 0x80, 0x4d, 0xc7, 0x9a, 0x8b,
  ]);
  discriminator.copy(instructionData, 0);

  // Message length and data
  instructionData.writeUInt32LE(messageBuffer.length, 8);
  messageBuffer.copy(instructionData, 12);

  // Attestation length and data
  const attestationOffset = 12 + messageBuffer.length;
  instructionData.writeUInt32LE(attestationBuffer.length, attestationOffset);
  attestationBuffer.copy(instructionData, attestationOffset + 4);

  // Build the instruction
  const receiveMessageIx = new TransactionInstruction({
    programId: CCTP_PROGRAMS.MESSAGE_TRANSMITTER,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // caller
      { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
      { pubkey: messageTransmitter, isSigner: false, isWritable: true }, // message_transmitter
      { pubkey: usedNonces, isSigner: false, isWritable: true }, // used_nonces
      {
        pubkey: CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER,
        isSigner: false,
        isWritable: false,
      }, // receiver
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      // Remaining accounts for token messenger minter
      { pubkey: tokenMessenger, isSigner: false, isWritable: false }, // token_messenger
      { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false }, // remote_token_messenger
      { pubkey: tokenMinter, isSigner: false, isWritable: true }, // token_minter
      { pubkey: localToken, isSigner: false, isWritable: true }, // local_token
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true }, // recipient_token_account
      { pubkey: mint, isSigner: false, isWritable: true }, // token_mint
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    ],
    data: instructionData,
  });

  // Build and send transaction
  const transaction = new Transaction();
  preInstructions.forEach((ix) => transaction.add(ix));
  transaction.add(receiveMessageIx);

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    payer,
  ]);

  // Parse amount from message
  const amount = parseAmount(params.message);

  return {
    signature,
    amount,
    recipientTokenAccount,
  };
}

// =============================================================================
// Message Parsing Helpers
// =============================================================================

/**
 * Parse source domain from CCTP message
 * Message format: [version (4)] [source_domain (4)] [destination_domain (4)] ...
 */
function parseSourceDomain(message: Uint8Array): number {
  const buffer = Buffer.from(message);
  return buffer.readUInt32BE(4); // Source domain at offset 4
}

/**
 * Parse nonce from CCTP message
 * Message format: ... [nonce (8)] ...
 */
function parseNonce(message: Uint8Array): bigint {
  const buffer = Buffer.from(message);
  // Nonce location depends on message version
  return buffer.readBigUInt64BE(12); // Nonce at offset 12
}

/**
 * Parse amount from CCTP message body
 */
function parseAmount(message: Uint8Array): bigint {
  const buffer = Buffer.from(message);
  // Amount is in the message body, position varies
  // This is a simplified parser - real implementation needs full message parsing
  return BigInt(0);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert an EVM address (20 bytes) to CCTP format (32 bytes, right-padded)
 */
export function evmAddressToCctp(evmAddress: string): Uint8Array {
  const addressBytes = Buffer.from(evmAddress.replace("0x", ""), "hex");
  if (addressBytes.length !== 20) {
    throw new Error("Invalid EVM address length");
  }
  const padded = Buffer.alloc(32);
  addressBytes.copy(padded, 12); // Right-pad with zeros on the left
  return new Uint8Array(padded);
}

/**
 * Convert a Solana public key to CCTP format (already 32 bytes)
 */
export function solanaAddressToCctp(publicKey: PublicKey): Uint8Array {
  return publicKey.toBytes();
}

/**
 * Get chain name from domain ID
 */
export function getChainName(domain: CctpDomain): string {
  return CHAIN_INFO[domain]?.name || `Unknown (${domain})`;
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerUrl(
  domain: CctpDomain,
  txHash: string
): string {
  const info = CHAIN_INFO[domain];
  if (!info) return "";

  if (domain === CCTP_DOMAINS.SOLANA) {
    return `${info.explorer}/tx/${txHash}`;
  }
  return `${info.explorer}/tx/${txHash}`;
}

/**
 * Estimate bridge time based on source chain
 * Returns estimated time in minutes for attestation
 */
export function estimateBridgeTime(sourceDomain: CctpDomain): {
  minMinutes: number;
  maxMinutes: number;
  description: string;
} {
  // Attestation time depends on source chain finality
  const estimates: Record<
    CctpDomain,
    { min: number; max: number; desc: string }
  > = {
    [CCTP_DOMAINS.ETHEREUM]: {
      min: 15,
      max: 20,
      desc: "~15-20 min (13 confirmations)",
    },
    [CCTP_DOMAINS.SOLANA]: { min: 1, max: 3, desc: "~1-3 min (32 slots)" },
    [CCTP_DOMAINS.BASE]: {
      min: 15,
      max: 20,
      desc: "~15-20 min (L2 finality)",
    },
    [CCTP_DOMAINS.ARBITRUM]: {
      min: 15,
      max: 20,
      desc: "~15-20 min (L2 finality)",
    },
    [CCTP_DOMAINS.OPTIMISM]: {
      min: 15,
      max: 20,
      desc: "~15-20 min (L2 finality)",
    },
    [CCTP_DOMAINS.POLYGON]: {
      min: 5,
      max: 10,
      desc: "~5-10 min (128 confirmations)",
    },
    [CCTP_DOMAINS.AVALANCHE]: {
      min: 1,
      max: 3,
      desc: "~1-3 min (fast finality)",
    },
    [CCTP_DOMAINS.NOBLE]: { min: 1, max: 2, desc: "~1-2 min (IBC)" },
    [CCTP_DOMAINS.SUI]: { min: 1, max: 2, desc: "~1-2 min (fast finality)" },
  };

  const estimate = estimates[sourceDomain] || { min: 15, max: 30, desc: "Unknown" };
  return {
    minMinutes: estimate.min,
    maxMinutes: estimate.max,
    description: estimate.desc,
  };
}

/**
 * Calculate approximate gas/fee for bridging
 */
export function estimateBridgeCost(
  destinationDomain: CctpDomain
): {
  estimatedUsd: string;
  description: string;
} {
  // Rough estimates - actual costs vary with gas prices
  const costs: Record<CctpDomain, { usd: string; desc: string }> = {
    [CCTP_DOMAINS.ETHEREUM]: {
      usd: "$5-15",
      desc: "ETH gas varies significantly",
    },
    [CCTP_DOMAINS.SOLANA]: {
      usd: "$0.01",
      desc: "Very low Solana fees",
    },
    [CCTP_DOMAINS.BASE]: { usd: "$0.10-0.50", desc: "Low L2 fees" },
    [CCTP_DOMAINS.ARBITRUM]: { usd: "$0.10-0.50", desc: "Low L2 fees" },
    [CCTP_DOMAINS.OPTIMISM]: { usd: "$0.10-0.50", desc: "Low L2 fees" },
    [CCTP_DOMAINS.POLYGON]: { usd: "$0.05-0.20", desc: "Low Polygon fees" },
    [CCTP_DOMAINS.AVALANCHE]: { usd: "$0.10-0.30", desc: "Moderate fees" },
    [CCTP_DOMAINS.NOBLE]: { usd: "$0.01", desc: "Low Cosmos fees" },
    [CCTP_DOMAINS.SUI]: { usd: "$0.01", desc: "Low Sui fees" },
  };

  const cost = costs[destinationDomain] || { usd: "Unknown", desc: "" };
  return {
    estimatedUsd: cost.usd,
    description: cost.desc,
  };
}

// =============================================================================
// High-Level API
// =============================================================================

/**
 * Complete bridge flow: burn on Solana, wait for attestation, receive on destination
 * Note: Receiving on non-Solana chains requires additional chain-specific implementation
 *
 * @param connection - Solana connection
 * @param payer - Payer keypair
 * @param amount - Amount to bridge (USDC, 6 decimals)
 * @param destinationDomain - Target chain
 * @param destinationRecipient - Recipient address (32 bytes)
 * @param config - Bridge configuration
 * @returns Bridge result with signatures
 */
export async function bridgeUsdcComplete(
  connection: Connection,
  payer: Keypair,
  amount: bigint,
  destinationDomain: CctpDomain,
  destinationRecipient: Uint8Array,
  config: BridgeConfig
): Promise<{
  depositSignature: string;
  messageHash: string;
  attestation: Uint8Array;
  estimatedArrival: string;
}> {
  console.log(
    `\nInitiating USDC bridge: ${Number(amount) / 1_000_000} USDC`
  );
  console.log(`From: Solana`);
  console.log(`To: ${getChainName(destinationDomain)}`);

  // Step 1: Burn USDC on Solana
  console.log("\n[1/3] Burning USDC on Solana...");
  const depositResult = await bridgeUsdcFromSolana(
    connection,
    payer,
    {
      amount,
      destinationDomain,
      destinationRecipient,
    },
    config
  );
  console.log(`Burn transaction: ${depositResult.signature}`);

  // Step 2: Wait for attestation
  console.log("\n[2/3] Waiting for Circle attestation...");
  const timeEstimate = estimateBridgeTime(CCTP_DOMAINS.SOLANA);
  console.log(`Estimated wait: ${timeEstimate.description}`);

  const attestationResult = await waitForAttestation(
    depositResult.messageHash,
    config.isMainnet
  );
  console.log("Attestation received!");

  // Step 3: For non-Solana destinations, user needs to claim on destination chain
  console.log("\n[3/3] Attestation ready for claiming on destination chain");

  return {
    depositSignature: depositResult.signature,
    messageHash: depositResult.messageHash,
    attestation: attestationResult.attestation!,
    estimatedArrival: `${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} minutes from now`,
  };
}

/**
 * Check USDC balance on Solana
 */
export async function getUsdcBalance(
  connection: Connection,
  owner: PublicKey,
  isMainnet: boolean = false
): Promise<bigint> {
  const mint = isMainnet ? USDC_MINT.MAINNET : USDC_MINT.DEVNET;
  const tokenAccount = await getAssociatedTokenAddress(mint, owner);

  try {
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return BigInt(balance.value.amount);
  } catch {
    return BigInt(0);
  }
}
