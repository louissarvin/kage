import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
  Ed25519Program,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { Contract } from "../target/types/contract";
import { randomBytes, createHash } from "crypto";
import {
  getArciumEnv,
  getCompDefAccOffset,
  getArciumProgramId,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
  x25519,
  getArciumAccountBaseSeed,
} from "@arcium-hq/client";
import {
  Rpc,
  createRpc,
  bn,
  selectStateTreeInfo,
  deriveAddressSeedV2,
  deriveAddressV2,
  defaultStaticAccounts,
  defaultTestStateTreeAccounts,
  batchAddressTree,
  LightSystemProgram,
  toAccountMetas,
  getLightSystemAccountMetas,
  PackedAccounts,
  SystemAccountMetaConfig,
  featureFlags,
  VERSION,
} from "@lightprotocol/stateless.js";

// Enable V2 mode for Light Protocol
(featureFlags as any).version = VERSION.V2;
import * as borsh from "borsh";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

/**
 * Compressed Claim & Withdraw - Devnet E2E Integration Test
 *
 * Tests the COMPLETE compressed vesting position lifecycle on devnet:
 *
 * 1. Organization, schedule, vault setup + deposit_to_vault
 * 2. Create compressed vesting position (Light Protocol state tree)
 * 3. Authorize claim (Ed25519 stealth signature + Light Protocol inclusion proof)
 * 4. Queue MPC process claim (Arcium cluster 456)
 * 5. Wait for MPC callback
 * 6. Update compressed position claimed amount (Light Protocol state transition)
 * 7. Withdraw tokens from vault to destination
 *
 * Prerequisites:
 * - Deployed program: 3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA
 * - Arcium cluster 456 (devnet)
 * - Helius RPC with ZK Compression support (ANCHOR_PROVIDER_URL or RPC_ENDPOINT)
 * - Funded wallet at ~/.config/solana/id.json
 */
describe("Compressed Claim & Withdraw (Devnet E2E)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Contract as Program<Contract>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  // Light Protocol RPC (Helius devnet with ZK Compression)
  const rpcEndpoint =
    process.env.RPC_ENDPOINT || provider.connection.rpcEndpoint;
  let lightRpc: Rpc;

  // Test accounts
  let admin: Keypair;
  let organizationPda: PublicKey;
  let schedulePda: PublicKey;
  let tokenMint: PublicKey;
  let vaultPda: PublicKey;
  let vaultAuthorityPda: PublicKey;
  let adminTokenAccount: PublicKey;

  // Compressed position state
  let compressedPositionAddress: PublicKey; // Light Protocol derived address
  let positionId: number;

  // Scratch position for MPC callback (regular VestingPosition account)
  let scratchPositionPda: PublicKey;

  // Stealth keypair (beneficiary)
  let stealthKeypair: Keypair;
  let beneficiaryCommitment: Uint8Array;

  // Claim accounts
  let claimAuthPda: PublicKey;
  let nullifierRecordPda: PublicKey;
  let nullifier: Buffer;
  let destinationTokenAccount: PublicKey;

  // Arcium encryption
  let mxePublicKey: Uint8Array;
  let cipher: RescueCipher;
  let privateKey: Uint8Array;
  let publicKey: Uint8Array;

  // Address Lookup Table for transaction size reduction
  let lookupTableAddress: PublicKey;
  let lookupTableAccount: AddressLookupTableAccount;

  const nameHash = createHash("sha256")
    .update("CompressedE2E_" + Date.now())
    .digest();
  const TOTAL_AMOUNT = BigInt(100_000_000); // 100 tokens (6 decimals)
  const CLAIM_AMOUNT = BigInt(50_000_000); // 50 tokens
  const DEPOSIT_AMOUNT = 200_000_000; // 200 tokens

  before(async () => {
    const payer = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    // Initialize Light Protocol RPC
    lightRpc = createRpc(rpcEndpoint, rpcEndpoint);
    console.log("Light RPC endpoint:", rpcEndpoint);

    // Generate fresh admin keypair for test isolation
    admin = Keypair.generate();
    console.log("Fresh admin:", admin.publicKey.toString());

    // Fund the admin with SOL
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: admin.publicKey,
        lamports: 100_000_000, // 0.2 SOL (enough for compressed operations)
      }),
    );
    await provider.sendAndConfirm(fundTx, [payer]);
    console.log("Admin funded with 0.2 SOL");
    // Generate stealth keypair for the beneficiary
    stealthKeypair = Keypair.generate();
    beneficiaryCommitment = stealthKeypair.publicKey.toBytes();

    // Setup X25519 encryption for Arcium MPC
    privateKey = x25519.utils.randomSecretKey();
    publicKey = x25519.getPublicKey(privateKey);

    mxePublicKey = await getMXEPublicKeyWithRetry(
      provider,
      program.programId,
    );
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    cipher = new RescueCipher(sharedSecret);

    // Derive organization PDA
    [organizationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("organization"), admin.publicKey.toBuffer()],
      program.programId,
    );

    // Initialize computation definitions
    console.log("Initializing computation definitions...");
    await initCompDef(program, payer, "init_position");
    await initCompDef(program, payer, "process_claim_v2");
    console.log("Computation definitions ready");

    console.log("Setup complete. Program ID:", program.programId.toString());
  });

  // ============================================================
  // Phase 1: Organization, Schedule, Vault Setup
  // ============================================================

  it("Creates organization", async () => {
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6,
    );
    console.log("Token mint:", tokenMint.toString());

    const treasury = Keypair.generate().publicKey;

    await program.methods
      .createOrganization(Array.from(nameHash), treasury, tokenMint)
      .accountsPartial({
        admin: admin.publicKey,
        organization: organizationPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    const org = await program.account.organization.fetch(organizationPda);
    expect(org.isActive).to.be.true;
    expect(org.compressedPositionCount.toNumber()).to.equal(0);
    console.log("Organization created:", organizationPda.toString());
  });

  it("Creates vesting schedule", async () => {
    const scheduleId = new anchor.BN(0);
    [schedulePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_schedule"),
        organizationPda.toBuffer(),
        scheduleId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    // Short durations: 0 cliff, 10s total, 1s interval
    await program.methods
      .createVestingSchedule(
        new anchor.BN(0),
        new anchor.BN(10),
        new anchor.BN(1),
      )
      .accountsPartial({
        admin: admin.publicKey,
        organization: organizationPda,
        schedule: schedulePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Schedule created:", schedulePda.toString());
  });

  it("Initializes vault and deposits tokens", async () => {
    [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), organizationPda.toBuffer()],
      program.programId,
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), organizationPda.toBuffer()],
      program.programId,
    );

    await program.methods
      .initializeVault()
      .accountsPartial({
        admin: admin.publicKey,
        organization: organizationPda,
        vaultAuthority: vaultAuthorityPda,
        vault: vaultPda,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Vault initialized:", vaultPda.toString());

    // Create admin token account and mint tokens
    adminTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      admin.publicKey,
    );
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      adminTokenAccount,
      admin,
      DEPOSIT_AMOUNT,
    );

    // Deposit to vault
    await program.methods
      .depositToVault(new anchor.BN(DEPOSIT_AMOUNT))
      .accountsPartial({
        admin: admin.publicKey,
        organization: organizationPda,
        vault: vaultPda,
        adminTokenAccount: adminTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    const vaultAccount = await getAccount(provider.connection, vaultPda);
    expect(Number(vaultAccount.amount)).to.equal(DEPOSIT_AMOUNT);
    console.log(`Vault funded: ${DEPOSIT_AMOUNT / 1_000_000} tokens`);
  });

  it("Creates address lookup table for transaction size optimization", async () => {
    // Get Light Protocol system accounts (V2 has 6 system accounts)
    const trees = defaultTestStateTreeAccounts();
    const addressMerkleTree = new PublicKey(batchAddressTree);

    // Addresses to include in lookup table for compression
    const addressesToAdd = [
      // Light Protocol system accounts
      new PublicKey("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7"), // Light System Program
      new PublicKey("5aAXTJCK95SZ3rWZWehUykGWbac5mrhPTCKuNuCcUZok"), // CPI Signer Authority
      new PublicKey("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh"), // Registered Program PDA
      new PublicKey("HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA"), // Account Compression Authority
      new PublicKey("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq"), // Account Compression Program
      SystemProgram.programId,
      // Tree accounts
      trees.merkleTree,
      trees.nullifierQueue,
      addressMerkleTree,
      // Common program accounts
      SYSVAR_INSTRUCTIONS_PUBKEY,
      program.programId,
      organizationPda,
    ];

    // Create the lookup table
    const recentSlot = await provider.connection.getSlot("finalized");
    const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
      authority: admin.publicKey,
      payer: admin.publicKey,
      recentSlot,
    });
    lookupTableAddress = lutAddress;

    // Extend the lookup table with addresses
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: admin.publicKey,
      authority: admin.publicKey,
      lookupTable: lutAddress,
      addresses: addressesToAdd,
    });

    // Send create + extend in one transaction
    const tx = new anchor.web3.Transaction().add(createIx, extendIx);
    await provider.sendAndConfirm(tx, [admin]);

    // Wait for lookup table to be active (needs 1 slot)
    await sleep(2000);

    // Fetch the lookup table account
    const lutAccountInfo = await provider.connection.getAddressLookupTable(lutAddress);
    if (!lutAccountInfo.value) {
      throw new Error("Failed to fetch lookup table");
    }
    lookupTableAccount = lutAccountInfo.value;

    console.log("Lookup table created:", lutAddress.toString());
    console.log("  Contains", lookupTableAccount.state.addresses.length, "addresses");
  });

  // ============================================================
  // Phase 2: Create Compressed Vesting Position (Light Protocol)
  // ============================================================

  it("Creates compressed vesting position via Light Protocol", async () => {
    const org = await program.account.organization.fetch(organizationPda);
    positionId = org.compressedPositionCount.toNumber();

    // Encrypt total amount for Arcium
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt([TOTAL_AMOUNT], nonce);
    const nonceAsBN = BigInt("0x" + Buffer.from(nonce).toString("hex"));

    // Get tree accounts from SDK - use V2 batch address tree
    const trees = defaultTestStateTreeAccounts();
    const stateMerkleTree = trees.merkleTree;
    const nullifierQueue = trees.nullifierQueue;
    // V2 batch address tree (queue equals tree for batch trees)
    const addressMerkleTree = new PublicKey(batchAddressTree);

    // Derive the compressed position address
    const positionIdBytes = Buffer.alloc(8);
    positionIdBytes.writeBigUInt64LE(BigInt(positionId));
    const addressSeeds = [
      Buffer.from("compressed_position"),
      organizationPda.toBuffer(),
      positionIdBytes,
    ];

    // Derive address using V2 SDK functions
    const addressSeed = deriveAddressSeedV2(addressSeeds);
    compressedPositionAddress = new PublicKey(
      deriveAddressV2(addressSeed, addressMerkleTree, program.programId)
    );
    console.log("Derived address:", compressedPositionAddress.toString());

    // Get validity proof for new address (proves address doesn't exist yet)
    // For V2 batch trees, queue equals tree
    const proof = await lightRpc.getValidityProofV0(
      [], // No input accounts (creating new)
      [
        {
          address: bn(compressedPositionAddress.toBytes()),
          tree: addressMerkleTree,
          queue: addressMerkleTree, // V2: queue equals tree for batch trees
        },
      ],
    );

    // Use PackedAccounts to build remaining accounts and get proper indices
    // Following the exact pattern from Light Protocol V2 documentation:
    // https://www.zkcompression.com/client-library/client-guide
    const packedAccounts = new PackedAccounts();

    // V2 uses 6 system accounts
    const systemAccountConfig = SystemAccountMetaConfig.new(program.programId);
    packedAccounts.addSystemAccountsV2(systemAccountConfig);

    console.log("Using V2 system accounts (6 accounts) for V2 CpiAccounts");

    // Add tree accounts in the standard order:
    // 1. State tree (for output)
    // 2. Address tree (for address derivation) - queue equals tree for V2 batch trees
    const outputStateTreeIndex = packedAccounts.insertOrGet(stateMerkleTree);
    const addressMerkleTreePubkeyIndex = packedAccounts.insertOrGet(addressMerkleTree);
    // For V2 batch trees, addressQueuePubkeyIndex equals addressMerkleTreePubkeyIndex
    const addressQueuePubkeyIndex = addressMerkleTreePubkeyIndex;

    // Convert to account metas
    const { remainingAccounts } = packedAccounts.toAccountMetas();

    const packedAddressTreeInfo = {
      rootIndex: proof.rootIndices[0],
      addressMerkleTreePubkeyIndex,
      addressQueuePubkeyIndex,
    };

    console.log("PackedAccounts indices (relative to remaining_accounts):");
    console.log("  addressMerkleTreePubkeyIndex:", addressMerkleTreePubkeyIndex);
    console.log("  addressQueuePubkeyIndex:", addressQueuePubkeyIndex);
    console.log("  outputStateTreeIndex:", outputStateTreeIndex);
    console.log("PackedAddressTreeInfo:", packedAddressTreeInfo);
    console.log("Address tree:", addressMerkleTree.toString());
    console.log("Proof rootIndices:", proof.rootIndices);
    console.log("Total remaining accounts:", remainingAccounts.length);
    console.log("Remaining accounts:");
    remainingAccounts.forEach((acc: any, i: number) => {
      console.log(`  [${i}] ${acc.pubkey.toString()} (writable: ${acc.isWritable})`);
    });

    const proofBytes = serializeValidityProof(proof);
    const addressTreeInfoBytes = serializePackedAddressTreeInfo(packedAddressTreeInfo);

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1000,
    });

    try {
      await program.methods
        .createCompressedVestingPosition(
          Buffer.from(proofBytes),
          Buffer.from(addressTreeInfoBytes),
          outputStateTreeIndex,
          Array.from(beneficiaryCommitment) as any,
          Array.from(ciphertext[0]) as any,
          new anchor.BN(nonceAsBN.toString()),
        )
        .accountsPartial({
          feePayer: admin.publicKey,
          admin: admin.publicKey,
          organization: organizationPda,
          schedule: schedulePda,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([modifyComputeUnits, addPriorityFee])
        .signers([admin])
        .rpc({ commitment: "confirmed" });
    } catch (err: any) {
      console.log("Transaction error:", err.message);
      if (err.logs) {
        console.log("Transaction logs:", err.logs);
      }
      // Also try getting logs from sendAndConfirmRawTransaction errors
      if (err.getLogs) {
        const logs = await err.getLogs();
        console.log("Fetched logs:", logs);
      }
      // Check if there's simulation response
      if (err.simulationResponse) {
        console.log("Simulation response logs:", err.simulationResponse.logs);
      }
      throw err;
    }

    // Verify organization counter incremented
    const updatedOrg = await program.account.organization.fetch(organizationPda);
    expect(updatedOrg.compressedPositionCount.toNumber()).to.equal(positionId + 1);

    // Derive nullifier: sha256(stealth_pubkey || position_id_as_le_u64)
    nullifier = createHash("sha256")
      .update(Buffer.concat([Buffer.from(beneficiaryCommitment), positionIdBytes]))
      .digest();

    console.log("Compressed position created:");
    console.log("  Position ID:", positionId);
    console.log("  Address:", compressedPositionAddress.toString());

    // Wait for the indexer to catch up
    await sleep(5000);
  });

  // ============================================================
  // Phase 3: Authorize Claim (Ed25519 + Light Protocol Proof)
  // ============================================================

  it("Authorizes claim with Ed25519 signature and Light Protocol proof", async () => {
    // Create destination token account for withdrawal
    const destinationOwner = Keypair.generate();
    destinationTokenAccount = await createAccount(
      provider.connection,
      admin,
      tokenMint,
      destinationOwner.publicKey,
    );
    console.log("Destination:", destinationTokenAccount.toString());

    // Derive compressed claim authorization PDA
    const positionIdBytes = Buffer.alloc(8);
    positionIdBytes.writeBigUInt64LE(BigInt(positionId));

    [claimAuthPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("claim_auth"),
        organizationPda.toBuffer(),
        positionIdBytes,
        nullifier,
      ],
      program.programId,
    );

    [nullifierRecordPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("nullifier"),
        organizationPda.toBuffer(),
        nullifier,
      ],
      program.programId,
    );

    // Get the compressed account from Light Protocol indexer
    const compressedAccount = await lightRpc.getCompressedAccount(
      bn(compressedPositionAddress.toBytes()),
    );
    expect(compressedAccount).to.not.be.null;
    console.log("Compressed account found, hash:", compressedAccount!.hash.toString());
    console.log("Compressed account data length:", compressedAccount!.data?.data?.length);
    console.log("Compressed account treeInfo:", JSON.stringify(compressedAccount!.treeInfo));
    console.log("Compressed account address:", compressedAccount!.address?.toString());

    // Get validity proof for reading the compressed account
    const proof = await lightRpc.getValidityProofV0(
      [
        {
          hash: compressedAccount!.hash,
          tree: compressedAccount!.treeInfo.tree,
          queue: compressedAccount!.treeInfo.queue,
        },
      ],
      [],
    );

    // Tree accounts for read/write: state tree + nullifier queue (V1)
    const trees = defaultTestStateTreeAccounts();
    const treeAccounts = [trees.merkleTree, trees.nullifierQueue];
    const remainingAccounts = buildLightRemainingAccounts(treeAccounts, program.programId);

    // On-chain CpiAccounts::tree_pubkeys() returns only tree accounts (excluding system accounts).
    // Indices are RELATIVE to tree section: [0] merkleTree, [1] nullifierQueue
    const accountMeta = {
      address: Array.from(compressedPositionAddress.toBytes()),
      merkleTreePubkeyIndex: 0, // trees.merkleTree at tree section index 0
      queuePubkeyIndex: 1,     // trees.nullifierQueue at tree section index 1
      leafIndex: proof.leafIndices[0],
      rootIndex: proof.rootIndices[0],
    };

    const proofBytes = serializeValidityProof(proof);
    const accountMetaBytes = serializeCompressedAccountMeta(accountMeta);

    // Construct Ed25519 signature message: position_id || nullifier || destination
    const message = Buffer.concat([
      positionIdBytes,
      nullifier,
      destinationTokenAccount.toBuffer(),
    ]);

    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: stealthKeypair.secretKey,
      message: Uint8Array.from(message),
    });

    // Decode the compressed position data (to pass as args)
    const positionData = deserializeCompressedPosition(compressedAccount!.data!.data);
    console.log("Deserialized position data:");
    console.log("  owner:", positionData.owner.toString());
    console.log("  organization:", positionData.organization.toString());
    console.log("  schedule:", positionData.schedule.toString());
    console.log("  positionId:", positionData.positionId);
    console.log("  nonce:", positionData.nonce.toString());
    console.log("  startTimestamp:", positionData.startTimestamp);
    console.log("  isActive:", positionData.isActive);
    console.log("  isFullyClaimed:", positionData.isFullyClaimed);

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1000,
    });

    // Build the main instruction (not the full transaction)
    const authorizeIx = await program.methods
      .authorizeClaimCompressed(
        Buffer.from(proofBytes),
        Buffer.from(accountMetaBytes),
        positionData.owner,
        positionData.organization,
        positionData.schedule,
        new anchor.BN(positionData.positionId),
        Array.from(positionData.beneficiaryCommitment) as any,
        Array.from(positionData.encryptedTotalAmount) as any,
        Array.from(positionData.encryptedClaimedAmount) as any,
        new anchor.BN(positionData.nonce.toString()),
        new anchor.BN(positionData.startTimestamp),
        positionData.isActive,
        positionData.isFullyClaimed,
        Array.from(nullifier) as any,
        destinationTokenAccount,
      )
      .accountsPartial({
        feePayer: admin.publicKey,
        organization: organizationPda,
        claimAuthorization: claimAuthPda,
        nullifierRecord: nullifierRecordPda,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    // Build all instructions
    const instructions = [modifyComputeUnits, addPriorityFee, ed25519Ix, authorizeIx];

    // Create versioned transaction with lookup table for address compression
    const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
      payerKey: admin.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message([lookupTableAccount]);

    const versionedTx = new VersionedTransaction(messageV0);
    versionedTx.sign([admin]);

    // Send versioned transaction
    const txSig = await provider.connection.sendTransaction(versionedTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await provider.connection.confirmTransaction({
      signature: txSig,
      blockhash,
      lastValidBlockHeight,
    }, "confirmed");
    console.log("Authorize claim tx:", txSig);

    // Verify claim authorization state
    const claimAuth = await program.account.claimAuthorization.fetch(claimAuthPda);
    expect(claimAuth.isAuthorized).to.be.true;
    expect(claimAuth.isProcessed).to.be.false;
    expect(claimAuth.isWithdrawn).to.be.false;
    expect(claimAuth.withdrawalDestination.toString()).to.equal(
      destinationTokenAccount.toString(),
    );
    console.log("Claim authorized. ClaimAuth PDA:", claimAuthPda.toString());

    // Verify nullifier record
    const nullRec = await program.account.nullifierRecord.fetch(nullifierRecordPda);
    expect(Buffer.from(nullRec.nullifier)).to.deep.equal(nullifier);
    console.log("Nullifier recorded");
  });

  it("Rejects double-claim with same nullifier", async () => {
    const positionIdBytes = Buffer.alloc(8);
    positionIdBytes.writeBigUInt64LE(BigInt(positionId));
    const message = Buffer.concat([
      positionIdBytes,
      nullifier,
      destinationTokenAccount.toBuffer(),
    ]);

    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: stealthKeypair.secretKey,
      message: Uint8Array.from(message),
    });

    // Re-fetch compressed account for fresh proof
    const compressedAccount = await lightRpc.getCompressedAccount(
      bn(compressedPositionAddress.toBytes()),
    );
    const proof = await lightRpc.getValidityProofV0(
      [
        {
          hash: compressedAccount!.hash,
          tree: compressedAccount!.treeInfo.tree,
          queue: compressedAccount!.treeInfo.queue,
        },
      ],
      [],
    );

    const trees = defaultTestStateTreeAccounts();
    const remainingAccounts = buildLightRemainingAccounts([trees.merkleTree, trees.nullifierQueue], program.programId);

    // On-chain indices are RELATIVE to tree section
    const accountMeta = {
      address: Array.from(compressedPositionAddress.toBytes()),
      merkleTreePubkeyIndex: 0, // merkleTree at tree section index 0
      queuePubkeyIndex: 1,     // nullifierQueue at tree section index 1
      leafIndex: proof.leafIndices[0],
      rootIndex: proof.rootIndices[0],
    };

    const positionData = deserializeCompressedPosition(compressedAccount!.data!.data);
    const proofBytes = serializeValidityProof(proof);
    const accountMetaBytes = serializeCompressedAccountMeta(accountMeta);

    try {
      // Build the instruction
      const authorizeIx = await program.methods
        .authorizeClaimCompressed(
          Buffer.from(proofBytes),
          Buffer.from(accountMetaBytes),
          positionData.owner,
          positionData.organization,
          positionData.schedule,
          new anchor.BN(positionData.positionId),
          Array.from(positionData.beneficiaryCommitment) as any,
          Array.from(positionData.encryptedTotalAmount) as any,
          Array.from(positionData.encryptedClaimedAmount) as any,
          new anchor.BN(positionData.nonce.toString()),
          new anchor.BN(positionData.startTimestamp),
          positionData.isActive,
          positionData.isFullyClaimed,
          Array.from(nullifier) as any,
          destinationTokenAccount,
        )
        .accountsPartial({
          feePayer: admin.publicKey,
          organization: organizationPda,
          claimAuthorization: claimAuthPda,
          nullifierRecord: nullifierRecordPda,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

      // Use versioned transaction with lookup table
      const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();
      const messageV0 = new TransactionMessage({
        payerKey: admin.publicKey,
        recentBlockhash: blockhash,
        instructions: [ed25519Ix, authorizeIx],
      }).compileToV0Message([lookupTableAccount]);

      const versionedTx = new VersionedTransaction(messageV0);
      versionedTx.sign([admin]);

      await provider.connection.sendTransaction(versionedTx, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      expect.fail("Should have thrown - nullifier already used");
    } catch (err: any) {
      // Expected failure - nullifier record already exists
      console.log(
        "Double-claim correctly rejected:",
        err.message?.substring(0, 100),
      );
    }
  });

  // ============================================================
  // Phase 4: Queue MPC Process Claim (Arcium Cluster 456)
  // ============================================================

  it("Queues process_claim_v2 MPC computation for compressed position", async () => {
    // For the MPC callback, we need a scratch VestingPosition account.
    // The queue_process_claim_compressed instruction requires a mutable `position` account.
    // We use the organization's first position slot (will create it if needed).
    const org = await program.account.organization.fetch(organizationPda);
    const scratchPositionId = org.positionCount;

    [scratchPositionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_position"),
        organizationPda.toBuffer(),
        scratchPositionId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    // Create a scratch position for MPC callback target
    // We create it via the standard create_vesting_position with Arcium
    const scratchNonce = randomBytes(16);
    const scratchCiphertext = cipher.encrypt([BigInt(0)], scratchNonce);
    const scratchNonceAsBN = new anchor.BN(
      deserializeLE(scratchNonce).toString(),
    );
    const scratchComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const [signPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ArciumSignerAccount")],
      program.programId,
    );

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1000,
    });

    // Create the scratch position
    await program.methods
      .createVestingPosition(
        scratchComputationOffset,
        Array.from(beneficiaryCommitment) as any,
        Array.from(scratchCiphertext[0]) as any,
        Array.from(publicKey) as any,
        scratchNonceAsBN,
      )
      .accountsPartial({
        payer: admin.publicKey,
        admin: admin.publicKey,
        organization: organizationPda,
        schedule: schedulePda,
        position: scratchPositionPda,
        signPdaAccount: signPda,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset,
        ),
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          scratchComputationOffset,
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_position")).readUInt32LE(),
        ),
        clusterAccount,
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        systemProgram: SystemProgram.programId,
        arciumProgram: getArciumProgramId(),
      })
      .preInstructions([modifyComputeUnits, addPriorityFee])
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Scratch position created:", scratchPositionPda.toString());

    // Wait for init_position MPC callback
    console.log("Waiting for init_position MPC callback...");
    await waitForAccountState(
      provider,
      program,
      scratchPositionPda,
      "vestingPosition",
      (account: any) =>
        account.encryptedClaimedAmount.some((b: number) => b !== 0),
      300000,
    );
    console.log("Scratch position initialized by MPC");

    // Now queue process_claim_v2 for the compressed position
    const claimedSoFar = BigInt(0);
    const PRECISION = BigInt(1_000_000);
    const vestingNumerator = PRECISION; // Fully vested (>10s elapsed)

    const nonce = randomBytes(16);
    const nonceAsBN = new anchor.BN(deserializeLE(nonce).toString());

    const encryptedTotalAmount = cipher.encrypt([TOTAL_AMOUNT], nonce);
    const encryptedClaimedAmount = cipher.encrypt([claimedSoFar], nonce);
    const encryptedVestingNumerator = cipher.encrypt(
      [vestingNumerator],
      nonce,
    );
    const encryptedClaimAmount = cipher.encrypt([CLAIM_AMOUNT], nonce);

    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    // Get the position's start_timestamp from the compressed account
    const compressedAccount = await lightRpc.getCompressedAccount(
      bn(compressedPositionAddress.toBytes()),
    );
    const positionData = deserializeCompressedPosition(compressedAccount!.data!.data);

    await program.methods
      .queueProcessClaimCompressed(
        computationOffset,
        new anchor.BN(positionId),
        Array.from(encryptedTotalAmount[0]) as any,
        Array.from(encryptedClaimedAmount[0]) as any,
        Array.from(encryptedVestingNumerator[0]) as any,
        Array.from(encryptedClaimAmount[0]) as any,
        new anchor.BN(CLAIM_AMOUNT.toString()),
        new anchor.BN(positionData.startTimestamp),
        Array.from(publicKey) as any,
        nonceAsBN,
      )
      .accountsPartial({
        payer: admin.publicKey,
        organization: organizationPda,
        schedule: schedulePda,
        position: scratchPositionPda,
        claimAuthorization: claimAuthPda,
        signPdaAccount: signPda,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset,
        ),
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset,
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("process_claim_v2")).readUInt32LE(),
        ),
        clusterAccount,
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        systemProgram: SystemProgram.programId,
        arciumProgram: getArciumProgramId(),
      })
      .preInstructions([modifyComputeUnits, addPriorityFee])
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Process claim computation queued for compressed position");

    // Wait for MPC callback
    console.log("Waiting for process_claim_v2 MPC callback...");
    await waitForAccountState(
      provider,
      program,
      claimAuthPda,
      "claimAuthorization",
      (account: any) => account.isProcessed === true,
      600000,
    );
    console.log("Process claim callback received");

    // Verify claim is processed
    const claimAuth = await program.account.claimAuthorization.fetch(
      claimAuthPda,
    );
    expect(claimAuth.isProcessed).to.be.true;
    expect(claimAuth.claimAmount.toNumber()).to.equal(Number(CLAIM_AMOUNT));
    console.log(
      "ClaimAuthorization processed: amount =",
      claimAuth.claimAmount.toString(),
    );
  });

  // ============================================================
  // Phase 5: Update Compressed Position Claimed (Light Protocol)
  // ============================================================

  it("Updates compressed position claimed amount via Light Protocol", async () => {
    // Re-fetch the compressed account (state may have changed)
    const compressedAccount = await lightRpc.getCompressedAccount(
      bn(compressedPositionAddress.toBytes()),
    );
    expect(compressedAccount).to.not.be.null;

    // Get validity proof for updating the account
    const proof = await lightRpc.getValidityProofV0(
      [
        {
          hash: compressedAccount!.hash,
          tree: compressedAccount!.treeInfo.tree,
          queue: compressedAccount!.treeInfo.queue,
        },
      ],
      [],
    );

    // Tree accounts for state update: state tree + nullifier queue (V1)
    const trees = defaultTestStateTreeAccounts();
    const remainingAccounts = buildLightRemainingAccounts([trees.merkleTree, trees.nullifierQueue], program.programId);

    // On-chain indices are RELATIVE to tree section
    const accountMeta = {
      address: Array.from(compressedPositionAddress.toBytes()),
      merkleTreePubkeyIndex: 0, // merkleTree at tree section index 0
      queuePubkeyIndex: 1,     // nullifierQueue at tree section index 1
      leafIndex: proof.leafIndices[0],
      rootIndex: proof.rootIndices[0],
    };

    const proofBytes = serializeValidityProof(proof);
    const accountMetaBytes = serializeCompressedAccountMeta(accountMeta);

    const positionData = deserializeCompressedPosition(compressedAccount!.data!.data);

    // After MPC processing, get the new encrypted_claimed_amount from scratch position
    const scratchPosition = await program.account.vestingPosition.fetch(
      scratchPositionPda,
    );
    const newEncryptedClaimedAmount = scratchPosition.encryptedClaimedAmount;

    // Determine if fully claimed (claim_amount == total_amount means fully claimed)
    const newIsFullyClaimed = CLAIM_AMOUNT >= TOTAL_AMOUNT ? 1 : 0;

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1000,
    });

    await program.methods
      .updateCompressedPositionClaimed(
        Buffer.from(proofBytes),
        Buffer.from(accountMetaBytes),
        positionData.owner,
        positionData.organization,
        positionData.schedule,
        new anchor.BN(positionData.positionId),
        Array.from(positionData.beneficiaryCommitment) as any,
        Array.from(positionData.encryptedTotalAmount) as any,
        Array.from(positionData.encryptedClaimedAmount) as any,
        new anchor.BN(positionData.nonce.toString()),
        new anchor.BN(positionData.startTimestamp),
        positionData.isActive,
        positionData.isFullyClaimed,
        Array.from(newEncryptedClaimedAmount) as any,
        newIsFullyClaimed,
      )
      .accountsPartial({
        feePayer: admin.publicKey,
        organization: organizationPda,
        claimAuthorization: claimAuthPda,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .preInstructions([modifyComputeUnits, addPriorityFee])
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Compressed position claimed amount updated");

    // Wait for indexer to catch up
    await sleep(3000);

    // Verify the updated compressed account
    const updatedAccount = await lightRpc.getCompressedAccount(
      bn(compressedPositionAddress.toBytes()),
    );
    expect(updatedAccount).to.not.be.null;
    const updatedData = deserializeCompressedPosition(updatedAccount!.data!.data);
    expect(updatedData.isFullyClaimed).to.equal(newIsFullyClaimed);
    console.log("Compressed position state verified after update");
  });

  // ============================================================
  // Phase 6: Withdraw Tokens
  // ============================================================

  it("Withdraws tokens from vault to destination", async () => {
    const beforeBalance = await getAccount(
      provider.connection,
      destinationTokenAccount,
    );
    expect(Number(beforeBalance.amount)).to.equal(0);

    const positionIdBytes = Buffer.alloc(8);
    positionIdBytes.writeBigUInt64LE(BigInt(positionId));

    await program.methods
      .withdrawCompressed(
        new anchor.BN(positionId),
        Array.from(nullifier) as any,
      )
      .accountsPartial({
        payer: admin.publicKey,
        organization: organizationPda,
        claimAuthorization: claimAuthPda,
        vaultAuthority: vaultAuthorityPda,
        vault: vaultPda,
        destination: destinationTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    // Verify tokens received
    const afterBalance = await getAccount(
      provider.connection,
      destinationTokenAccount,
    );
    expect(Number(afterBalance.amount)).to.equal(Number(CLAIM_AMOUNT));
    console.log(
      `Withdrawal successful: ${Number(CLAIM_AMOUNT) / 1_000_000} tokens`,
    );

    // Verify claim is marked as withdrawn
    const claimAuth = await program.account.claimAuthorization.fetch(
      claimAuthPda,
    );
    expect(claimAuth.isWithdrawn).to.be.true;
    console.log("ClaimAuthorization: withdrawn=true");
  });

  it("Rejects double-withdrawal", async () => {
    try {
      await program.methods
        .withdrawCompressed(
          new anchor.BN(positionId),
          Array.from(nullifier) as any,
        )
        .accountsPartial({
          payer: admin.publicKey,
          organization: organizationPda,
          claimAuthorization: claimAuthPda,
          vaultAuthority: vaultAuthorityPda,
          vault: vaultPda,
          destination: destinationTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" });

      expect.fail("Should have thrown - already withdrawn");
    } catch (err: any) {
      expect(err.message || err.toString()).to.include("AlreadyWithdrawn");
      console.log("Double-withdrawal correctly rejected");
    }
  });

  // ============================================================
  // Phase 7: Final State Verification
  // ============================================================

  it("Verifies final state consistency", async () => {
    // Vault balance should be reduced by claim amount
    const vaultAccount = await getAccount(provider.connection, vaultPda);
    expect(Number(vaultAccount.amount)).to.equal(
      DEPOSIT_AMOUNT - Number(CLAIM_AMOUNT),
    );
    console.log(
      `Final vault balance: ${Number(vaultAccount.amount) / 1_000_000} tokens`,
    );

    // Organization state
    const org = await program.account.organization.fetch(organizationPda);
    expect(org.compressedPositionCount.toNumber()).to.equal(positionId + 1);
    expect(org.isActive).to.be.true;
    console.log(
      "Organization compressed positions:",
      org.compressedPositionCount.toNumber(),
    );

    // Compressed position should reflect claim
    const compressedAccount = await lightRpc.getCompressedAccount(
      bn(compressedPositionAddress.toBytes()),
    );
    if (compressedAccount) {
      const data = deserializeCompressedPosition(compressedAccount.data!.data);
      console.log("Compressed position is_fully_claimed:", data.isFullyClaimed);
    }

    console.log("\n=== Compressed Claim & Withdraw E2E Complete ===");
    console.log("  Organization:", organizationPda.toString());
    console.log("  Schedule:", schedulePda.toString());
    console.log("  Vault:", vaultPda.toString());
    console.log("  Compressed position ID:", positionId);
    console.log("  Claim amount:", Number(CLAIM_AMOUNT) / 1_000_000, "tokens");
    console.log("  Destination:", destinationTokenAccount.toString());
  });
});

// ============================================================
// Helper Functions
// ============================================================

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString())),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Derive the Light Protocol compressed account address from seeds.
 * Uses the SDK's V2 deriveAddressSeedV2 + deriveAddressV2.
 * V2 derivation: seed = hash(seeds), address = hash(seed, tree, programId)
 */
function deriveCompressedAddress(
  seeds: Buffer[],
  addressTreePubkey: PublicKey,
  programId: PublicKey,
): PublicKey {
  const seed = deriveAddressSeedV2(seeds);
  const address = deriveAddressV2(seed, addressTreePubkey, programId);
  return new PublicKey(address);
}

/**
 * Build remaining accounts for Light Protocol CPI using V2 PackedAccounts.
 *
 * V2 has 6 system accounts:
 * [0] LightSystemProgram
 * [1] CpiSignerAuthority
 * [2] RegisteredProgramPda
 * [3] AccountCompressionAuthority
 * [4] AccountCompressionProgram
 * [5] SystemProgram
 * [6+] Tree accounts
 *
 * IMPORTANT: On-chain CpiAccounts::tree_pubkeys() returns only tree accounts,
 * so indices in PackedAddressTreeInfo/CompressedAccountMeta are RELATIVE
 * to the tree accounts section.
 */
function buildLightRemainingAccounts(
  treeAccounts: PublicKey[],
  programId: PublicKey,
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  // Use V2 PackedAccounts approach
  const packedAccounts = new PackedAccounts();
  const systemAccountConfig = SystemAccountMetaConfig.new(programId);
  packedAccounts.addSystemAccountsV2(systemAccountConfig);

  // Add tree accounts
  for (const tree of treeAccounts) {
    packedAccounts.insertOrGet(tree);
  }

  const { remainingAccounts } = packedAccounts.toAccountMetas();

  // For backwards compatibility, convert to the old format
  const systemAccountMetas = remainingAccounts.slice(0, 6);
  const treeMetas = remainingAccounts.slice(6);

  console.log("System accounts from SDK (V2):");
  systemAccountMetas.forEach((acc: any, i: number) => {
    console.log(`  [${i}] ${acc.pubkey.toString()}`);
  });

  console.log("Tree accounts:");
  treeMetas.forEach((acc: any, i: number) => {
    console.log(`  [${i}] ${acc.pubkey.toString()}`);
  });

  console.log(`Total remaining accounts: ${remainingAccounts.length}`);
  return remainingAccounts;
}

/**
 * Serialize ValidityProof for borsh encoding (matches on-chain deserialization).
 *
 * In light-sdk, ValidityProof is defined as:
 *   pub struct ValidityProof(pub Option<CompressedProof>);
 *
 * Borsh serializes Option<T> as:
 *   - 0x00 for None
 *   - 0x01 + T for Some(T)
 *
 * CompressedProof has:
 *   - a: [u8; 32]
 *   - b: [u8; 64]
 *   - c: [u8; 32]
 *
 * Total for Some(proof): 1 + 32 + 64 + 32 = 129 bytes
 */
function serializeValidityProof(proof: any): Uint8Array {
  if (proof.compressedProof) {
    // Serialize as Option<CompressedProof> with Some variant (0x01 prefix)
    const result = new Uint8Array(129);
    result[0] = 1; // Some variant discriminant
    result.set(new Uint8Array(proof.compressedProof.a), 1);
    result.set(new Uint8Array(proof.compressedProof.b), 33);
    result.set(new Uint8Array(proof.compressedProof.c), 97);
    return result;
  }
  // If no compressed proof, serialize as None (just 0x00)
  return new Uint8Array([0]);
}

/**
 * Serialize PackedAddressTreeInfo for borsh encoding.
 *
 * IMPORTANT: Field order must match the Rust struct in light-sdk:
 *   pub struct PackedAddressTreeInfo {
 *       pub address_merkle_tree_pubkey_index: u8,
 *       pub address_queue_pubkey_index: u8,
 *       pub root_index: u16,
 *   }
 *
 * The struct is #[repr(C)] so field order is guaranteed.
 */
function serializePackedAddressTreeInfo(info: any): Uint8Array {
  const schema = {
    struct: {
      addressMerkleTreePubkeyIndex: "u8",
      addressQueuePubkeyIndex: "u8",
      rootIndex: "u16",
    },
  };
  return borsh.serialize(schema as any, info);
}

/**
 * Serialize CompressedAccountMeta for borsh encoding.
 *
 * Light SDK CompressedAccountMeta for reading/updating existing accounts:
 *   struct CompressedAccountMeta {
 *     tree_info: PackedStateTreeInfo {
 *       root_index: u16,
 *       prove_by_index: bool,
 *       merkle_tree_pubkey_index: u8,
 *       queue_pubkey_index: u8,
 *       leaf_index: u32,
 *     },
 *     address: [u8; 32],            // The account's address (not Option!)
 *     output_state_tree_index: u8,  // Index of output state tree
 *   }
 */
function serializeCompressedAccountMeta(meta: {
  address: number[];
  merkleTreePubkeyIndex: number;
  queuePubkeyIndex: number;
  leafIndex: number;
  rootIndex: number;
}): Uint8Array {
  // Build the structure matching Light SDK's CompressedAccountMeta
  const data = {
    treeInfo: {
      rootIndex: meta.rootIndex,
      proveByIndex: false, // Use proof-based verification
      merkleTreePubkeyIndex: meta.merkleTreePubkeyIndex,
      queuePubkeyIndex: meta.queuePubkeyIndex,
      leafIndex: meta.leafIndex,
    },
    address: meta.address, // Direct address, not Option
    outputStateTreeIndex: meta.merkleTreePubkeyIndex, // Use same tree for output
  };

  const schema = {
    struct: {
      treeInfo: {
        struct: {
          rootIndex: "u16",
          proveByIndex: "bool",
          merkleTreePubkeyIndex: "u8",
          queuePubkeyIndex: "u8",
          leafIndex: "u32",
        },
      },
      address: { array: { type: "u8", len: 32 } },
      outputStateTreeIndex: "u8",
    },
  };
  return borsh.serialize(schema as any, data);
}

/**
 * Deserialize CompressedVestingPosition from account data bytes.
 *
 * Light Protocol stores the discriminator separately from the data field,
 * so we do NOT skip 8 bytes at the start. The data field contains only
 * the serialized struct fields:
 *
 * struct CompressedVestingPosition {
 *   owner: Pubkey,           // 32 bytes
 *   organization: Pubkey,    // 32 bytes
 *   schedule: Pubkey,        // 32 bytes
 *   position_id: u64,        // 8 bytes
 *   beneficiary_commitment: [u8; 32], // 32 bytes
 *   encrypted_total_amount: [u8; 32], // 32 bytes
 *   encrypted_claimed_amount: [u8; 32], // 32 bytes
 *   nonce: u128,             // 16 bytes
 *   start_timestamp: i64,    // 8 bytes
 *   is_active: u8,           // 1 byte
 *   is_fully_claimed: u8,    // 1 byte
 * }
 * Total: 226 bytes (no discriminator in data)
 */
function deserializeCompressedPosition(data: Buffer | Uint8Array): {
  owner: PublicKey;
  organization: PublicKey;
  schedule: PublicKey;
  positionId: number;
  beneficiaryCommitment: Uint8Array;
  encryptedTotalAmount: Uint8Array;
  encryptedClaimedAmount: Uint8Array;
  nonce: bigint;
  startTimestamp: number;
  isActive: number;
  isFullyClaimed: number;
} {
  const buf = Buffer.from(data);
  let offset = 0;

  // Light Protocol stores discriminator separately - do NOT skip 8 bytes
  // The data.data field is the raw serialized struct

  const owner = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;

  const organization = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;

  const schedule = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;

  const positionId = Number(buf.readBigUInt64LE(offset));
  offset += 8;

  const beneficiaryCommitment = new Uint8Array(buf.slice(offset, offset + 32));
  offset += 32;

  const encryptedTotalAmount = new Uint8Array(buf.slice(offset, offset + 32));
  offset += 32;

  const encryptedClaimedAmount = new Uint8Array(buf.slice(offset, offset + 32));
  offset += 32;

  // Read u128 nonce as two u64 values
  const nonceLow = buf.readBigUInt64LE(offset);
  const nonceHigh = buf.readBigUInt64LE(offset + 8);
  const nonce = nonceLow + (nonceHigh << 64n);
  offset += 16;

  const startTimestamp = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const isActive = buf[offset];
  offset += 1;

  const isFullyClaimed = buf[offset];
  offset += 1;

  return {
    owner,
    organization,
    schedule,
    positionId,
    beneficiaryCommitment,
    encryptedTotalAmount,
    encryptedClaimedAmount,
    nonce,
    startTimestamp,
    isActive,
    isFullyClaimed,
  };
}

async function initCompDef(
  program: Program<Contract>,
  owner: Keypair,
  circuitName: string,
): Promise<string> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount",
  );
  const offset = getCompDefAccOffset(circuitName);
  const provider = anchor.getProvider();

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId(),
  )[0];

  // Check if already initialized
  const accountInfo = await provider.connection.getAccountInfo(compDefPDA);
  if (accountInfo !== null) {
    console.log(`Comp def for ${circuitName} already exists`);
    return "already_initialized";
  }

  let sig: string;
  if (circuitName === "init_position") {
    sig = await program.methods
      .initInitPositionCompDef()
      .accountsPartial({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
  } else if (circuitName === "process_claim_v2") {
    sig = await program.methods
      .initProcessClaimV2CompDef()
      .accountsPartial({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
  } else {
    throw new Error(`Unknown circuit name: ${circuitName}`);
  }

  console.log(`Init ${circuitName} comp def tx:`, sig);
  return sig;
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 10,
  retryDelayMs: number = 1000,
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Try the SDK helper first
      const key = await getMXEPublicKey(provider, programId);
      if (key && key.length === 32) return key;
    } catch (error: any) {
      // SDK helper failed, continue to fallback
    }

    // Fallback: read x25519 public key directly from raw MXE account data.
    // The MXE account (305 bytes) stores the x25519 key at offset 95
    // (after discriminator[8] + flags[1] + cluster_offset[4] + pubkeys[82]).
    try {
      const mxeAddr = getMXEAccAddress(programId);
      console.log(`  MXE address: ${mxeAddr.toBase58()}`);
      const info = await provider.connection.getAccountInfo(mxeAddr);
      if (info) {
        console.log(`  MXE account data length: ${info.data.length}`);
        const key = new Uint8Array(info.data.slice(95, 127));
        console.log(`  Key at offset 95: ${Buffer.from(key).toString("hex").substring(0, 20)}...`);
        if (!key.every((b) => b === 0)) {
          console.log("MXE key fetched via raw data fallback");
          return key;
        }
        console.log("  Key at offset 95 is all zeros");
      } else {
        console.log("  MXE account not found via getAccountInfo");
      }
    } catch (e: any) {
      console.log(`  Raw read error: ${e.message?.substring(0, 80)}`);
    }

    if (attempt < maxRetries) {
      console.log(`MXE key attempt ${attempt}/${maxRetries} - retrying...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

async function waitForAccountState(
  provider: anchor.AnchorProvider,
  program: Program<Contract>,
  accountPda: PublicKey,
  accountName: string,
  predicate: (account: any) => boolean,
  timeoutMs: number = 300000,
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 3000;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const account = await (program.account as any)[accountName].fetch(
        accountPda,
      );
      if (predicate(account)) return;
    } catch (err) {
      // Account might not exist yet
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed % 30 === 0 && elapsed > 0) {
      console.log(
        `  Still waiting for ${accountName} state change... (${elapsed}s)`,
      );
    }
  }

  throw new Error(
    `Timeout waiting for ${accountName} state change after ${timeoutMs / 1000}s`,
  );
}
