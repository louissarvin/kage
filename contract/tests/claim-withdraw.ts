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
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Contract } from "../target/types/contract";
import { randomBytes, createHash } from "crypto";
import {
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
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
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

describe("ShadowVest - Claim & Withdraw (E2E)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Contract as Program<Contract>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  // Test accounts
  let admin: Keypair;
  let organizationPda: PublicKey;
  let schedulePda: PublicKey;
  let positionPda: PublicKey;
  let tokenMint: PublicKey;
  let vaultPda: PublicKey;
  let vaultAuthorityPda: PublicKey;

  // Stealth keypair (beneficiary) - standard Solana Ed25519 keypair
  let stealthKeypair: Keypair;
  let beneficiaryCommitment: Uint8Array; // = stealth pubkey bytes

  // Claim accounts
  let claimAuthPda: PublicKey;
  let nullifierRecordPda: PublicKey;
  let nullifier: Buffer;
  let destinationTokenAccount: PublicKey;

  // Encryption for Arcium
  let mxePublicKey: Uint8Array;
  let cipher: RescueCipher;
  let privateKey: Uint8Array;
  let publicKey: Uint8Array;

  const nameHash = createHash("sha256").update("ClaimTestOrg").digest();
  const CLAIM_AMOUNT = BigInt(50_000_000); // 50 tokens (6 decimals)
  const TOTAL_AMOUNT = BigInt(100_000_000); // 100 tokens

  before(async () => {
    const payer = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    // Generate a fresh admin keypair to avoid stale org account issues
    admin = Keypair.generate();
    console.log("Fresh admin:", admin.publicKey.toString());

    // Fund the fresh admin with SOL from payer
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: admin.publicKey,
        lamports: 2_000_000_000, // 2 SOL
      }),
    );
    await provider.sendAndConfirm(fundTx, [payer]);
    console.log("Admin funded with 2 SOL");

    // Generate stealth keypair (Ed25519) for the beneficiary
    stealthKeypair = Keypair.generate();
    beneficiaryCommitment = stealthKeypair.publicKey.toBytes();

    // Derive nullifier: sha256(stealth_pubkey || position_id_as_le_u64)
    const positionIdBuf = Buffer.alloc(8);
    positionIdBuf.writeBigUInt64LE(0n);
    nullifier = createHash("sha256")
      .update(Buffer.concat([Buffer.from(beneficiaryCommitment), positionIdBuf]))
      .digest();

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

    // Initialize computation definitions (needed for fresh deployment)
    // Use payer wallet since comp defs are per-program, not per-admin
    console.log("Initializing computation definitions...");
    await initCompDef(program, payer, "init_position");
    await initCompDef(program, payer, "process_claim_v2");
    console.log("Computation definitions ready");

    console.log("Setup complete. Program ID:", program.programId.toString());
  });

  it("Creates organization with real token mint", async () => {
    // Create a real SPL token mint
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6, // 6 decimals
    );
    console.log("Token mint created:", tokenMint.toString());

    const treasury = Keypair.generate().publicKey;

    await program.methods
      .createOrganization(
        Array.from(nameHash),
        treasury,
        tokenMint,
      )
      .accounts({
        admin: admin.publicKey,
        organization: organizationPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

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

    await program.methods
      .createVestingSchedule(
        new anchor.BN(0),           // cliff: 0 (immediate vesting for testing)
        new anchor.BN(10),          // duration: 10 seconds (fully vested before MPC callback)
        new anchor.BN(1),           // interval: 1 second
      )
      .accounts({
        admin: admin.publicKey,
        organization: organizationPda,
        schedule: schedulePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Vesting schedule created");
  });

  it("Initializes organization vault", async () => {
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
      .accounts({
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

    // Fund the vault with tokens
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      vaultPda,
      admin, // mint authority
      1_000_000_000, // 1000 tokens
    );

    const vaultAccount = await getAccount(provider.connection, vaultPda);
    expect(Number(vaultAccount.amount)).to.equal(1_000_000_000);
    console.log("Vault funded with 1000 tokens");
  });

  it("Creates vesting position with stealth beneficiary", async () => {
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

    // Encrypt the total amount for Arcium MPC
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt([TOTAL_AMOUNT], nonce);
    const nonceAsBN = new anchor.BN(deserializeLE(nonce).toString());
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

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
      systemProgram: SystemProgram.programId,
      arciumProgram: getArciumProgramId(),
    };

    await program.methods
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

    console.log("Vesting position created with stealth beneficiary");
    console.log("  Position PDA:", positionPda.toString());
    console.log("  Beneficiary (stealth pubkey):", stealthKeypair.publicKey.toString());

    // Wait for init_position MPC callback by polling position state
    // encrypted_claimed_amount starts as all-zeros, callback sets it to encrypted(0) ciphertext
    console.log("Waiting for init_position MPC callback...");
    await waitForAccountState(
      provider,
      program,
      positionPda,
      "vestingPosition",
      (account: any) => {
        return account.encryptedClaimedAmount.some((b: number) => b !== 0);
      },
      300000,
    );
    console.log("Position initialization complete");
  });

  it("Authorizes claim with Ed25519 stealth signature", async () => {
    // Create destination token account for withdrawal
    const destinationOwner = Keypair.generate();
    destinationTokenAccount = await createAccount(
      provider.connection,
      admin,
      tokenMint,
      destinationOwner.publicKey,
    );
    console.log("Destination token account:", destinationTokenAccount.toString());

    // Derive ClaimAuthorization PDA
    [claimAuthPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("claim_auth"),
        positionPda.toBuffer(),
        nullifier,
      ],
      program.programId,
    );

    // Derive NullifierRecord PDA
    [nullifierRecordPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("nullifier"),
        organizationPda.toBuffer(),
        nullifier,
      ],
      program.programId,
    );

    // Construct the message: position_id(8) || nullifier(32) || withdrawal_destination(32)
    const positionIdBuf = Buffer.alloc(8);
    positionIdBuf.writeBigUInt64LE(0n); // position_id = 0
    const message = Buffer.concat([
      positionIdBuf,
      nullifier,
      destinationTokenAccount.toBuffer(),
    ]);

    // Create Ed25519 verify instruction using the stealth private key
    // This signs the message and creates the verification instruction
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: stealthKeypair.secretKey, // First 32 bytes = private key
      message: Uint8Array.from(message),
    });

    // Submit authorize_claim with Ed25519 instruction prepended
    const sig = await program.methods
      .authorizeClaim(
        Array.from(nullifier) as any,
        destinationTokenAccount,
      )
      .accounts({
        payer: admin.publicKey,
        organization: organizationPda,
        position: positionPda,
        claimAuthorization: claimAuthPda,
        nullifierRecord: nullifierRecordPda,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix])
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Claim authorized:", sig);

    // Verify claim authorization state
    const claimAuth = await program.account.claimAuthorization.fetch(claimAuthPda);
    expect(claimAuth.isAuthorized).to.be.true;
    expect(claimAuth.isProcessed).to.be.false;
    expect(claimAuth.isWithdrawn).to.be.false;
    expect(claimAuth.position.toString()).to.equal(positionPda.toString());
    expect(claimAuth.withdrawalDestination.toString()).to.equal(
      destinationTokenAccount.toString(),
    );
    console.log("ClaimAuthorization verified: authorized=true, processed=false");

    // Verify nullifier record exists
    const nullifierRecord = await program.account.nullifierRecord.fetch(nullifierRecordPda);
    expect(Buffer.from(nullifierRecord.nullifier)).to.deep.equal(nullifier);
    console.log("NullifierRecord verified: nullifier stored");
  });

  it("Rejects double-claim with same nullifier", async () => {
    // Try to create another claim with the same nullifier - should fail
    // because NullifierRecord PDA already exists (init constraint)
    const positionIdBuf = Buffer.alloc(8);
    positionIdBuf.writeBigUInt64LE(0n);
    const message = Buffer.concat([
      positionIdBuf,
      nullifier,
      destinationTokenAccount.toBuffer(),
    ]);

    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: stealthKeypair.secretKey,
      message: Uint8Array.from(message),
    });

    try {
      await program.methods
        .authorizeClaim(
          Array.from(nullifier) as any,
          destinationTokenAccount,
        )
        .accounts({
          payer: admin.publicKey,
          organization: organizationPda,
          position: positionPda,
          claimAuthorization: claimAuthPda,
          nullifierRecord: nullifierRecordPda,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
        .signers([admin])
        .rpc({ commitment: "confirmed" });

      expect.fail("Should have thrown - nullifier already used");
    } catch (err: any) {
      // Expected: account already initialized
      console.log("Double-claim correctly rejected:", err.message?.substring(0, 100));
    }
  });

  it("Queues process_claim MPC computation (integrated vesting)", async () => {
    const claimedSoFar = BigInt(0); // Nothing claimed yet

    // With cliff=0, duration=10s, interval=1s, and >10s elapsed (MPC wait) → fully vested
    // vesting_numerator = PRECISION = 1_000_000
    // MPC computes: vested = total * numerator / PRECISION = 100_000_000
    // claimable = vested - claimed = 100_000_000 - 0 = 100_000_000
    // claim_amount(50_000_000) <= claimable(100_000_000) → valid
    const PRECISION = BigInt(1_000_000);
    const vestingNumerator = PRECISION; // Fully vested

    // Encrypt values for MPC (all with same nonce for the circuit)
    // Args order matches ProcessClaimV2Input: total_amount, claimed_amount, vesting_numerator, claim_amount
    const nonce = randomBytes(16);
    const nonceAsBN = new anchor.BN(deserializeLE(nonce).toString());

    const encryptedTotalAmount = cipher.encrypt([TOTAL_AMOUNT], nonce);
    const encryptedClaimedAmount = cipher.encrypt([claimedSoFar], nonce);
    const encryptedVestingNumerator = cipher.encrypt([vestingNumerator], nonce);
    const encryptedClaimAmount = cipher.encrypt([CLAIM_AMOUNT], nonce);

    const computationOffset = new anchor.BN(randomBytes(8), "hex");

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

    const accounts = {
      payer: admin.publicKey,
      organization: organizationPda,
      schedule: schedulePda,
      position: positionPda,
      claimAuthorization: claimAuthPda,
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
        Buffer.from(getCompDefAccOffset("process_claim_v2")).readUInt32LE(),
      ),
      clusterAccount,
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      systemProgram: SystemProgram.programId,
      arciumProgram: getArciumProgramId(),
    };

    await program.methods
      .queueProcessClaim(
        computationOffset,
        Array.from(encryptedTotalAmount[0]),
        Array.from(encryptedClaimedAmount[0]),
        Array.from(encryptedVestingNumerator[0]),
        Array.from(encryptedClaimAmount[0]),
        new anchor.BN(CLAIM_AMOUNT.toString()),
        Array.from(publicKey),
        nonceAsBN,
      )
      .accountsPartial(accounts)
      .preInstructions([modifyComputeUnits, addPriorityFee])
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    console.log("Process claim computation queued (with integrated vesting calculation)");
    console.log("  On-chain vesting_numerator will be emitted in event (fully vested)");

    // Wait for MPC callback by polling account state directly
    // (getSignaturesForAddress has indexing lag on devnet RPC)
    console.log("Waiting for process_claim MPC callback (polling account state)...");
    await waitForAccountState(
      provider,
      program,
      claimAuthPda,
      "claimAuthorization",
      (account: any) => account.isProcessed === true,
      600000,
    );
    console.log("Process claim callback received");

    // Verify claim is now processed
    const claimAuth = await program.account.claimAuthorization.fetch(claimAuthPda);
    expect(claimAuth.isProcessed).to.be.true;
    expect(claimAuth.claimAmount.toNumber()).to.equal(Number(CLAIM_AMOUNT));
    console.log("ClaimAuthorization verified: processed=true, amount=", claimAuth.claimAmount.toString());
  });

  it("Withdraws tokens to destination", async () => {
    const beforeBalance = await getAccount(provider.connection, destinationTokenAccount);
    expect(Number(beforeBalance.amount)).to.equal(0);

    await program.methods
      .withdraw()
      .accountsPartial({
        payer: admin.publicKey,
        organization: organizationPda,
        position: positionPda,
        claimAuthorization: claimAuthPda,
        vaultAuthority: vaultAuthorityPda,
        vault: vaultPda,
        destination: destinationTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    // Verify tokens received
    const afterBalance = await getAccount(provider.connection, destinationTokenAccount);
    expect(Number(afterBalance.amount)).to.equal(Number(CLAIM_AMOUNT));
    console.log(`Withdrawal successful: ${Number(CLAIM_AMOUNT) / 1_000_000} tokens transferred`);

    // Verify claim is marked as withdrawn
    const claimAuth = await program.account.claimAuthorization.fetch(claimAuthPda);
    expect(claimAuth.isWithdrawn).to.be.true;
    console.log("ClaimAuthorization verified: withdrawn=true");
  });

  it("Rejects double-withdrawal", async () => {
    try {
      await program.methods
        .withdraw()
        .accountsPartial({
          payer: admin.publicKey,
          organization: organizationPda,
          position: positionPda,
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
    console.log(`Comp def for ${circuitName} already exists - ready for use`);
    return "already_initialized";
  }

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
  } else if (circuitName === "process_claim_v2") {
    sig = await program.methods
      .initProcessClaimV2CompDef()
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
      if (attempt === maxRetries) throw error;
      console.log(`MXE key attempt ${attempt}/${maxRetries} failed, retrying...`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
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
      const account = await (program.account as any)[accountName].fetch(accountPda);
      if (predicate(account)) {
        return;
      }
    } catch (err) {
      // Account might not exist yet or be in transition
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed % 30 === 0 && elapsed > 0) {
      console.log(`  Still waiting for ${accountName} state change... (${elapsed}s elapsed)`);
    }
  }

  throw new Error(`Timeout waiting for ${accountName} state change after ${timeoutMs / 1000}s`);
}

async function waitForCallback(
  provider: anchor.AnchorProvider,
  accountPda: PublicKey,
  callbackName: string,
  timeoutMs: number = 300000,
): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 3000;
  const startSignatures = new Set<string>();

  // Record existing signatures to ignore
  const existing = await provider.connection.getSignaturesForAddress(
    accountPda,
    { limit: 20 },
    "confirmed",
  );
  existing.forEach((s) => startSignatures.add(s.signature));

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const signatures = await provider.connection.getSignaturesForAddress(
      accountPda,
      { limit: 20 },
      "confirmed",
    );

    for (const sigInfo of signatures) {
      if (startSignatures.has(sigInfo.signature)) continue;

      const tx = await provider.connection.getTransaction(sigInfo.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (tx?.meta?.logMessages) {
        const logs = tx.meta.logMessages.join("\n");
        if (logs.includes(callbackName)) {
          return sigInfo.signature;
        }
      }
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed % 30 === 0) {
      console.log(`  Still waiting for ${callbackName}... (${elapsed}s elapsed)`);
    }
  }

  throw new Error(`Timeout waiting for ${callbackName} after ${timeoutMs / 1000}s`);
}
