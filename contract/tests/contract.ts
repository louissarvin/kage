import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { Contract } from "../target/types/contract";
import { randomBytes, createHash } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  buildFinalizeCompDefTx,
  uploadCircuit,
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
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

describe("ShadowVest", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Contract as Program<Contract>;
  const provider = anchor.getProvider();

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  // Test accounts
  let admin: Keypair;
  let organizationPda: PublicKey;
  let schedulePda: PublicKey;
  let positionPda: PublicKey;
  let mxePublicKey: Uint8Array;
  let cipher: RescueCipher;
  let privateKey: Uint8Array;
  let publicKey: Uint8Array;

  // Test data
  const nameHash = createHash("sha256").update("TestOrg").digest();
  const treasury = Keypair.generate().publicKey;
  const tokenMint = Keypair.generate().publicKey;
  const beneficiaryCommitment = createHash("sha256").update("employee123").digest();

  before(async () => {
    admin = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    // Initialize computation definitions
    console.log("Initializing computation definitions...");

    await initCompDef(program, admin, "init_position");
    console.log("init_position computation definition initialized");

    // Initialize calculate_vested comp def (optimized circuit: 1.3MB)
    await initCompDef(program, admin, "calculate_vested");
    console.log("calculate_vested computation definition initialized");

    // process_claim can be enabled later if needed
    // await initCompDef(program, admin, "process_claim");

    // Get MXE public key for encryption
    mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId,
    );
    console.log("MXE x25519 pubkey fetched");

    // Setup encryption
    privateKey = x25519.utils.randomSecretKey();
    publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    cipher = new RescueCipher(sharedSecret);

    // Derive PDAs
    [organizationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("organization"), admin.publicKey.toBuffer()],
      program.programId,
    );
  });

  it("Creates an organization", async () => {
    // Check if organization already exists
    const existingOrg = await provider.connection.getAccountInfo(organizationPda);
    if (existingOrg !== null) {
      console.log("Organization already exists, verifying state...");
      const orgAccount = await program.account.organization.fetch(organizationPda);
      expect(orgAccount.admin.toString()).to.equal(admin.publicKey.toString());
      expect(orgAccount.isActive).to.equal(true);
      return;
    }

    const sig = await program.methods
      .createOrganization(
        Array.from(nameHash),
        treasury,
        tokenMint,
      )
      .accounts({
        admin: admin.publicKey,
        organization: organizationPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Create organization signature:", sig);

    // Verify organization account
    const orgAccount = await program.account.organization.fetch(organizationPda);
    expect(orgAccount.admin.toString()).to.equal(admin.publicKey.toString());
    expect(orgAccount.scheduleCount.toNumber()).to.equal(0);
    expect(orgAccount.positionCount.toNumber()).to.equal(0);
    expect(orgAccount.isActive).to.equal(true);
    expect(Buffer.from(orgAccount.nameHash)).to.deep.equal(nameHash);
    expect(orgAccount.tokenMint.toString()).to.equal(tokenMint.toString());
  });

  it("Creates a vesting schedule", async () => {
    const orgAccount = await program.account.organization.fetch(organizationPda);

    // Use schedule ID 0 (first schedule)
    const scheduleId = new anchor.BN(0);

    [schedulePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_schedule"),
        organizationPda.toBuffer(),
        scheduleId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    // Check if schedule already exists
    const existingSchedule = await provider.connection.getAccountInfo(schedulePda);
    if (existingSchedule !== null) {
      console.log("Vesting schedule already exists, verifying state...");
      const scheduleAccount = await program.account.vestingSchedule.fetch(schedulePda);
      expect(scheduleAccount.organization.toString()).to.equal(organizationPda.toString());
      expect(scheduleAccount.isActive).to.equal(true);
      return;
    }

    const cliffDuration = new anchor.BN(30 * 24 * 60 * 60); // 30 days in seconds
    const totalDuration = new anchor.BN(365 * 24 * 60 * 60); // 1 year in seconds
    const vestingInterval = new anchor.BN(24 * 60 * 60); // 1 day in seconds

    const sig = await program.methods
      .createVestingSchedule(cliffDuration, totalDuration, vestingInterval)
      .accounts({
        admin: admin.publicKey,
        organization: organizationPda,
        schedule: schedulePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Create vesting schedule signature:", sig);

    // Verify schedule account
    const scheduleAccount = await program.account.vestingSchedule.fetch(schedulePda);
    expect(scheduleAccount.organization.toString()).to.equal(organizationPda.toString());
    expect(scheduleAccount.cliffDuration.toNumber()).to.equal(cliffDuration.toNumber());
    expect(scheduleAccount.totalDuration.toNumber()).to.equal(totalDuration.toNumber());
    expect(scheduleAccount.vestingInterval.toNumber()).to.equal(vestingInterval.toNumber());
    expect(scheduleAccount.isActive).to.equal(true);

    // Verify organization schedule count incremented
    const updatedOrg = await program.account.organization.fetch(organizationPda);
    expect(updatedOrg.scheduleCount.toNumber()).to.equal(1);
  });

  it("Creates a vesting position with encrypted amount", async () => {
    const orgAccount = await program.account.organization.fetch(organizationPda);
    const positionId = orgAccount.positionCount;

    [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_position"),
        organizationPda.toBuffer(),
        positionId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    // Encrypt the vesting amount (e.g., 1000 tokens)
    const totalAmount = BigInt(1000_000_000); // 1000 tokens with 6 decimals
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt([totalAmount], nonce);

    const computationOffset = new anchor.BN(randomBytes(8), "hex");
    const nonceAsBN = new anchor.BN(deserializeLE(nonce).toString());

    // Derive sign PDA with correct Arcium seed
    const [signPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ArciumSignerAccount")],
      program.programId,
    );

    // Add compute budget instructions for Arcium MPC
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1000,
    });

    // Debug: log accounts
    const accounts = {
      payer: admin.publicKey,
      admin: admin.publicKey,
      organization: organizationPda,
      schedule: schedulePda,
      position: positionPda,
      signPdaAccount: signPda,
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
      executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
      computationAccount: getComputationAccAddress(
        arciumEnv.arciumClusterOffset,
        computationOffset,
      ),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("init_position")).readUInt32LE(),
      ),
      clusterAccount,
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      systemProgram: anchor.web3.SystemProgram.programId,
      arciumProgram: getArciumProgramId(),
    };

    console.log("Account addresses:");
    for (const [key, value] of Object.entries(accounts)) {
      console.log(`  ${key}: ${value?.toString()}`);
    }

    try {
      const sig = await program.methods
        .createVestingPosition(
          computationOffset,
          Array.from(beneficiaryCommitment),
          Array.from(ciphertext[0]),
          Array.from(publicKey),
          nonceAsBN,
        )
        .accountsPartial(accounts)
        .preInstructions([modifyComputeUnits, addPriorityFee])
        .signers([admin])
        .rpc({ commitment: "confirmed" });

      console.log("Create vesting position signature:", sig);
    } catch (error: any) {
      console.error("Error creating position:", error);
      if (error.logs) {
        console.log("Transaction logs:", error.logs);
      }
      throw error;
    }

    // Verify position account was created
    const positionAccount = await program.account.vestingPosition.fetch(positionPda);
    expect(positionAccount.organization.toString()).to.equal(organizationPda.toString());
    expect(positionAccount.schedule.toString()).to.equal(schedulePda.toString());
    expect(positionAccount.isActive).to.equal(true);
    expect(positionAccount.isFullyClaimed).to.equal(false);
    expect(Buffer.from(positionAccount.beneficiaryCommitment)).to.deep.equal(beneficiaryCommitment);

    // Verify organization position count incremented
    const updatedOrg = await program.account.organization.fetch(organizationPda);
    expect(updatedOrg.positionCount.toNumber()).to.equal(positionId.toNumber() + 1);

    // Wait for MPC computation to finalize (this updates encrypted amounts)
    console.log("Waiting for MPC computation to finalize...");
    const finalizeSig = await waitForPositionEncryption(
      provider as anchor.AnchorProvider,
      program,
      positionPda,
      60000, // 60 second timeout
    );
    console.log("Position computation finalized:", finalizeSig);
  });

  it("Calculates vested amount", async () => {
    const computationOffset = new anchor.BN(randomBytes(8), "hex");
    const nonce = randomBytes(16);
    const nonceAsBN = new anchor.BN(deserializeLE(nonce).toString());

    // Get position and schedule data
    const positionAccount = await program.account.vestingPosition.fetch(positionPda);
    const scheduleAccount = await program.account.vestingSchedule.fetch(schedulePda);

    // Calculate vesting numerator client-side (same logic as on-chain)
    const PRECISION = BigInt(1_000_000);
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const startTimestamp = BigInt(positionAccount.startTimestamp.toString());
    const cliffDuration = BigInt(scheduleAccount.cliffDuration.toString());
    const totalDuration = BigInt(scheduleAccount.totalDuration.toString());
    const vestingInterval = BigInt(scheduleAccount.vestingInterval.toString());

    let vestingNumerator = BigInt(0);
    const elapsed = currentTimestamp > startTimestamp ? currentTimestamp - startTimestamp : BigInt(0);

    if (elapsed >= cliffDuration) {
      if (elapsed >= totalDuration) {
        vestingNumerator = PRECISION;
      } else {
        const vestingDuration = totalDuration - cliffDuration;
        if (vestingDuration > BigInt(0)) {
          const timeAfterCliff = elapsed - cliffDuration;
          const intervalsPassed = vestingInterval > BigInt(0) ? timeAfterCliff / vestingInterval : timeAfterCliff;
          const vestedTime = vestingInterval > BigInt(0) ? intervalsPassed * vestingInterval : timeAfterCliff;
          vestingNumerator = (vestedTime * PRECISION) / vestingDuration;
          if (vestingNumerator > PRECISION) vestingNumerator = PRECISION;
        } else {
          vestingNumerator = PRECISION;
        }
      }
    }

    console.log("Vesting calculation:");
    console.log("  Current timestamp:", currentTimestamp.toString());
    console.log("  Start timestamp:", startTimestamp.toString());
    console.log("  Elapsed seconds:", elapsed.toString());
    console.log("  Cliff duration:", cliffDuration.toString());
    console.log("  Vesting numerator:", vestingNumerator.toString());

    // Read stored encrypted amounts from position and decrypt to re-encrypt with new nonce
    // Actually, we need to encrypt fresh values with the new nonce
    // The stored encrypted_total_amount was encrypted with a different nonce during init

    // For MPC to work, all inputs must be encrypted with the SAME key/nonce pair
    // So we need to encrypt all three values fresh:
    // 1. total_amount - we need to know the plaintext value (this is the tricky part)
    // 2. claimed_amount - starts at 0
    // 3. vesting_numerator - computed above

    // Since this is a test with known values, we can use the original total amount
    const totalAmount = BigInt(1000_000_000); // Same as when position was created
    const claimedAmount = BigInt(0); // Initial claimed amount

    // Encrypt all three values with the same nonce
    const ciphertextTotal = cipher.encrypt([totalAmount], nonce);
    const ciphertextClaimed = cipher.encrypt([claimedAmount], nonce);
    const ciphertextNumerator = cipher.encrypt([vestingNumerator], nonce);

    // Derive sign PDA with correct Arcium seed
    const [signPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ArciumSignerAccount")],
      program.programId,
    );

    // Add compute budget instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1000,
    });

    const accounts = {
      payer: admin.publicKey,
      organization: organizationPda,
      schedule: schedulePda,
      position: positionPda,
      signPdaAccount: signPda,
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
      executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
      computationAccount: getComputationAccAddress(
        arciumEnv.arciumClusterOffset,
        computationOffset,
      ),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("calculate_vested")).readUInt32LE(),
      ),
      clusterAccount,
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      systemProgram: anchor.web3.SystemProgram.programId,
      arciumProgram: getArciumProgramId(),
    };

    console.log("Calculate vested accounts:");
    console.log("  compDefAccount:", accounts.compDefAccount.toString());

    const sig = await program.methods
      .calculateVestedAmount(
        computationOffset,
        Array.from(ciphertextTotal[0]),
        Array.from(ciphertextClaimed[0]),
        Array.from(ciphertextNumerator[0]),
        Array.from(publicKey),
        nonceAsBN,
      )
      .accountsPartial(accounts)
      .preInstructions([modifyComputeUnits, addPriorityFee])
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Calculate vested amount signature:", sig);

    // Wait for MPC computation to finalize using custom polling
    // Note: MPC on devnet can take several minutes for larger circuits
    console.log("Waiting for vested calculation MPC to finalize (up to 5 min)...");
    const finalizeSig = await waitForCalculateVestedCallback(
      provider as anchor.AnchorProvider,
      positionPda,
      300000, // 5 minute timeout
    );
    console.log("Vested calculation finalized:", finalizeSig);
  });
});

// Helper functions

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

  console.log(`Comp def PDA for ${circuitName}:`, compDefPDA.toString());

  // Check if already initialized
  const accountInfo = await provider.connection.getAccountInfo(compDefPDA);
  if (accountInfo !== null) {
    // For OffChain circuit source, comp def is ready as soon as it's initialized
    // No finalization needed - MPC nodes fetch circuit directly from URL
    console.log(`Comp def for ${circuitName} already exists - ready for use`);
    return "already_initialized";
  }

  // Call the appropriate init method based on circuit name
  let sig: string;
  if (circuitName === "init_position") {
    sig = await program.methods
      .initInitPositionCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
  } else if (circuitName === "calculate_vested") {
    sig = await program.methods
      .initCalculateVestedCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
  } else if (circuitName === "process_claim") {
    sig = await program.methods
      .initProcessClaimCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
  } else {
    throw new Error(`Unknown circuit name: ${circuitName}`);
  }

  console.log(`Init ${circuitName} computation definition tx:`, sig);

  // For OffChain circuit source, no upload or finalization needed
  // The comp def is complete with the URL and hash - MPC nodes fetch directly
  console.log(`Using OffChain circuit source - comp def ready (no finalization needed)`);

  return sig;
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500,
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(
        `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`,
  );
}

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString())),
  );
}

// Custom polling function that checks for callback transaction on the position account
async function waitForPositionEncryption(
  provider: anchor.AnchorProvider,
  program: Program<Contract>,
  positionPda: PublicKey,
  timeoutMs: number = 60000,
): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 2000; // Poll every 2 seconds
  let lastSignature: string | undefined;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Get recent transaction signatures for the position account
      const signatures = await provider.connection.getSignaturesForAddress(
        positionPda,
        { limit: 10 },
        "confirmed",
      );

      // Look for a transaction that's newer than our start and contains callback
      for (const sigInfo of signatures) {
        if (sigInfo.signature === lastSignature) continue;

        // Get transaction details to check for callback
        const tx = await provider.connection.getTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (tx?.meta?.logMessages) {
          const logs = tx.meta.logMessages.join("\n");
          if (logs.includes("InitPositionCallback")) {
            // Found the callback transaction
            return sigInfo.signature;
          }
        }
      }

      // Track last checked signature to avoid re-checking
      if (signatures.length > 0) {
        lastSignature = signatures[0].signature;
      }
    } catch (error) {
      // Ignore errors and continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    process.stdout.write(".");
  }

  // If we timeout, check if the position was already updated (callback might have happened before we started watching)
  try {
    const signatures = await provider.connection.getSignaturesForAddress(
      positionPda,
      { limit: 20 },
      "confirmed",
    );

    for (const sigInfo of signatures) {
      const tx = await provider.connection.getTransaction(sigInfo.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (tx?.meta?.logMessages) {
        const logs = tx.meta.logMessages.join("\n");
        if (logs.includes("InitPositionCallback")) {
          return sigInfo.signature;
        }
      }
    }
  } catch (error) {
    // Ignore
  }

  throw new Error(`Timeout waiting for position encryption callback after ${timeoutMs}ms`);
}

// Custom polling function for calculate_vested callback
async function waitForCalculateVestedCallback(
  provider: anchor.AnchorProvider,
  positionPda: PublicKey,
  timeoutMs: number = 60000,
): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const signatures = await provider.connection.getSignaturesForAddress(
        positionPda,
        { limit: 10 },
        "confirmed",
      );

      for (const sigInfo of signatures) {
        const tx = await provider.connection.getTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (tx?.meta?.logMessages) {
          const logs = tx.meta.logMessages.join("\n");
          if (logs.includes("CalculateVestedCallback")) {
            return sigInfo.signature;
          }
        }
      }
    } catch (error) {
      // Ignore errors and continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    process.stdout.write(".");
  }

  // Final check before timeout
  try {
    const signatures = await provider.connection.getSignaturesForAddress(
      positionPda,
      { limit: 20 },
      "confirmed",
    );

    for (const sigInfo of signatures) {
      const tx = await provider.connection.getTransaction(sigInfo.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (tx?.meta?.logMessages) {
        const logs = tx.meta.logMessages.join("\n");
        if (logs.includes("CalculateVestedCallback")) {
          return sigInfo.signature;
        }
      }
    }
  } catch (error) {
    // Ignore
  }

  throw new Error(`Timeout waiting for calculate_vested callback after ${timeoutMs}ms`);
}
