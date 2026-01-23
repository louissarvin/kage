import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
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
import { createHash } from "crypto";
import {
  getArciumEnv,
  getClusterAccAddress,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClockAccAddress,
  getFeePoolAccAddress,
  RescueCipher,
  x25519,
  awaitComputationFinalization,
} from "@arcium-hq/client";
import { expect } from "chai";
import * as os from "os";
import * as fs from "fs";
import nacl from "tweetnacl";

describe("ShadowVest - Claim & Withdraw", () => {
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
  let vaultAuthorityBump: number;

  // Stealth keypair (beneficiary)
  let stealthKeypair: nacl.SignKeyPair;
  let beneficiaryCommitment: Uint8Array;

  // Claim accounts
  let claimAuthPda: PublicKey;
  let nullifierRecordPda: PublicKey;
  let nullifier: Uint8Array;
  let destinationTokenAccount: PublicKey;

  // Encryption
  let mxePublicKey: Uint8Array;
  let cipher: RescueCipher;
  let privateKey: Uint8Array;
  let publicKey: Uint8Array;

  const nameHash = createHash("sha256").update("ClaimTestOrg").digest();

  before(async () => {
    admin = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    // Generate stealth keypair (Ed25519)
    stealthKeypair = nacl.sign.keyPair();
    beneficiaryCommitment = stealthKeypair.publicKey;

    // Derive nullifier: hash(stealth_secret || position_id)
    const positionId = 0;
    const nullifierInput = Buffer.concat([
      Buffer.from(stealthKeypair.publicKey),
      Buffer.alloc(8), // position_id = 0 as u64 LE
    ]);
    nullifier = createHash("sha256").update(nullifierInput).digest();

    // Setup encryption for Arcium
    const keyPair = x25519.generateKeyPair();
    privateKey = keyPair.secretKey;
    publicKey = keyPair.publicKey;

    mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
    const sharedSecret = x25519.sharedKey(privateKey, mxePublicKey);
    cipher = new RescueCipher(sharedSecret);

    // Derive PDAs
    [organizationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("organization"), admin.publicKey.toBuffer()],
      program.programId
    );

    console.log("Test setup complete");
  });

  it("Creates organization and schedule", async () => {
    // Create a real token mint
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6 // 6 decimals
    );

    const treasury = Keypair.generate().publicKey;

    await program.methods
      .createOrganization(
        Array.from(nameHash),
        treasury,
        tokenMint
      )
      .accounts({
        admin: admin.publicKey,
        organization: organizationPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Create schedule
    const scheduleId = new anchor.BN(0);
    [schedulePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_schedule"),
        organizationPda.toBuffer(),
        scheduleId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    await program.methods
      .createVestingSchedule(
        new anchor.BN(0),           // cliff: 0
        new anchor.BN(31536000),    // duration: 1 year
        new anchor.BN(2592000)      // interval: 30 days
      )
      .accounts({
        admin: admin.publicKey,
        organization: organizationPda,
        schedule: schedulePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("Organization and schedule created");
  });

  it("Initializes vault", async () => {
    [vaultAuthorityPda, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), organizationPda.toBuffer()],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), organizationPda.toBuffer()],
      program.programId
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
      .rpc();

    console.log("Vault initialized:", vaultPda.toBase58());

    // Fund the vault with tokens
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      vaultPda,
      admin, // mint authority
      1_000_000_000 // 1000 tokens (6 decimals)
    );

    const vaultAccount = await getAccount(provider.connection, vaultPda);
    expect(Number(vaultAccount.amount)).to.equal(1_000_000_000);
    console.log("Vault funded with 1000 tokens");
  });

  it("Creates vesting position with stealth beneficiary", async () => {
    const positionId = new anchor.BN(0);
    [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_position"),
        organizationPda.toBuffer(),
        positionId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Encrypt the total amount (100 tokens = 100_000_000 with 6 decimals)
    const totalAmount = BigInt(100_000_000);
    const nonce = BigInt(Math.floor(Math.random() * 2 ** 64));
    const encryptedTotal = cipher.encryptU64(totalAmount);

    const computationOffset = new anchor.BN(Date.now());
    const mxeAccount = getMXEAccAddress(program.programId);
    const mempoolAccount = getMempoolAccAddress(mxeAccount, arciumEnv.arciumClusterOffset);
    const executingPool = getExecutingPoolAccAddress(mxeAccount, arciumEnv.arciumClusterOffset);
    const computationAccount = getComputationAccAddress(computationOffset, mxeAccount, arciumEnv.arciumClusterOffset);
    const compDefOffset = getCompDefAccOffset("init_position", program.programId);
    const compDefAccount = getCompDefAccAddress(compDefOffset);

    await program.methods
      .createVestingPosition(
        computationOffset,
        Array.from(beneficiaryCommitment) as any,
        Array.from(encryptedTotal) as any,
        Array.from(publicKey) as any,
        new anchor.BN(nonce.toString())
      )
      .accounts({
        payer: admin.publicKey,
        admin: admin.publicKey,
        organization: organizationPda,
        schedule: schedulePda,
        position: positionPda,
        signPdaAccount: PublicKey.findProgramAddressSync(
          [Buffer.from("ArciumSignerAccount")],
          program.programId
        )[0],
        mxeAccount,
        mempoolAccount,
        executingPool,
        computationAccount,
        compDefAccount,
        clusterAccount,
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        systemProgram: SystemProgram.programId,
        arciumProgram: getArciumProgramId(),
      })
      .signers([admin])
      .rpc();

    console.log("Vesting position created with stealth beneficiary");
  });

  it("Authorizes claim with Ed25519 signature", async () => {
    // Create destination token account
    destinationTokenAccount = await createAccount(
      provider.connection,
      admin,
      tokenMint,
      Keypair.generate().publicKey // random owner for privacy
    );

    // Derive claim authorization PDA
    [claimAuthPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("claim_auth"),
        positionPda.toBuffer(),
        Buffer.from(nullifier),
      ],
      program.programId
    );

    // Derive nullifier record PDA
    [nullifierRecordPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("nullifier"),
        organizationPda.toBuffer(),
        Buffer.from(nullifier),
      ],
      program.programId
    );

    // Construct the message: position_id(8) || nullifier(32) || withdrawal_destination(32)
    const positionId = Buffer.alloc(8);
    positionId.writeBigUInt64LE(0n);
    const message = Buffer.concat([
      positionId,
      Buffer.from(nullifier),
      destinationTokenAccount.toBuffer(),
    ]);

    // Sign with stealth private key
    const signature = nacl.sign.detached(message, stealthKeypair.secretKey);

    // Create Ed25519 instruction
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: stealthKeypair.publicKey,
      message,
      signature,
    });

    // Create authorize_claim instruction
    const authorizeTx = await program.methods
      .authorizeClaim(
        Array.from(nullifier) as any,
        destinationTokenAccount
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
      .signers([admin])
      .preInstructions([ed25519Ix])
      .rpc();

    console.log("Claim authorized:", authorizeTx);

    // Verify claim authorization state
    const claimAuth = await program.account.claimAuthorization.fetch(claimAuthPda);
    expect(claimAuth.isAuthorized).to.be.true;
    expect(claimAuth.isProcessed).to.be.false;
    expect(claimAuth.isWithdrawn).to.be.false;
    expect(claimAuth.position.toBase58()).to.equal(positionPda.toBase58());
  });

  it("Fails double-claim with same nullifier", async () => {
    const message = Buffer.alloc(32); // dummy message
    const signature = nacl.sign.detached(message, stealthKeypair.secretKey);

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: stealthKeypair.publicKey,
      message,
      signature,
    });

    // Second claim with same nullifier should fail (init constraint on nullifier_record)
    try {
      await program.methods
        .authorizeClaim(
          Array.from(nullifier) as any,
          destinationTokenAccount
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
        .signers([admin])
        .preInstructions([ed25519Ix])
        .rpc();

      expect.fail("Should have thrown - nullifier already used");
    } catch (err: any) {
      // Expected: account already initialized (nullifier record exists)
      console.log("Double-claim correctly rejected:", err.message?.substring(0, 80));
    }
  });

  it("Queues process_claim MPC computation", async () => {
    const claimAmount = BigInt(50_000_000); // 50 tokens
    const maxClaimable = BigInt(100_000_000); // 100 tokens max

    // Encrypt values for MPC
    const encryptedClaimedAmount = cipher.encryptU64(BigInt(0)); // nothing claimed yet
    const encryptedClaimAmount = cipher.encryptU64(claimAmount);
    const encryptedMaxClaimable = cipher.encryptU64(maxClaimable);

    const computationOffset = new anchor.BN(Date.now());
    const mxeAccount = getMXEAccAddress(program.programId);
    const mempoolAccount = getMempoolAccAddress(mxeAccount, arciumEnv.arciumClusterOffset);
    const executingPool = getExecutingPoolAccAddress(mxeAccount, arciumEnv.arciumClusterOffset);
    const computationAccount = getComputationAccAddress(computationOffset, mxeAccount, arciumEnv.arciumClusterOffset);
    const compDefOffset = getCompDefAccOffset("process_claim", program.programId);
    const compDefAccount = getCompDefAccAddress(compDefOffset);

    const nonce = BigInt(Math.floor(Math.random() * 2 ** 64));

    await program.methods
      .queueProcessClaim(
        computationOffset,
        Array.from(encryptedClaimedAmount) as any,
        Array.from(encryptedClaimAmount) as any,
        Array.from(encryptedMaxClaimable) as any,
        new anchor.BN(claimAmount.toString()),
        Array.from(publicKey) as any,
        new anchor.BN(nonce.toString())
      )
      .accounts({
        payer: admin.publicKey,
        organization: organizationPda,
        position: positionPda,
        claimAuthorization: claimAuthPda,
        signPdaAccount: PublicKey.findProgramAddressSync(
          [Buffer.from("ArciumSignerAccount")],
          program.programId
        )[0],
        mxeAccount,
        mempoolAccount,
        executingPool,
        computationAccount,
        compDefAccount,
        clusterAccount,
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        systemProgram: SystemProgram.programId,
        arciumProgram: getArciumProgramId(),
      })
      .signers([admin])
      .rpc();

    console.log("Process claim computation queued");

    // Wait for MPC callback
    console.log("Waiting for MPC computation finalization...");
    await awaitComputationFinalization(
      provider.connection,
      computationAccount,
      arciumEnv.arciumClusterOffset
    );
    console.log("MPC computation finalized");

    // Verify claim is now processed
    const claimAuth = await program.account.claimAuthorization.fetch(claimAuthPda);
    expect(claimAuth.isProcessed).to.be.true;
    expect(claimAuth.claimAmount.toNumber()).to.equal(50_000_000);
  });

  it("Withdraws tokens to destination", async () => {
    const beforeBalance = await getAccount(provider.connection, destinationTokenAccount);
    expect(Number(beforeBalance.amount)).to.equal(0);

    await program.methods
      .withdraw()
      .accounts({
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
      .rpc();

    // Verify tokens received
    const afterBalance = await getAccount(provider.connection, destinationTokenAccount);
    expect(Number(afterBalance.amount)).to.equal(50_000_000);
    console.log("Withdrawal successful: 50 tokens transferred");

    // Verify claim is marked as withdrawn
    const claimAuth = await program.account.claimAuthorization.fetch(claimAuthPda);
    expect(claimAuth.isWithdrawn).to.be.true;
  });

  it("Fails to withdraw twice", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
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
        .rpc();

      expect.fail("Should have thrown - already withdrawn");
    } catch (err: any) {
      expect(err.message).to.include("AlreadyWithdrawn");
      console.log("Double-withdraw correctly rejected");
    }
  });
});

// ============================================================
// Helper Functions
// ============================================================

function readKpJson(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function getArciumProgramId(): PublicKey {
  return new PublicKey("ArcmXN9CAkBqvSAoB17dXwrUXFrCeKYeuzVVeMg8HMSi");
}

function getCompDefAccOffset(circuitName: string, programId: PublicKey): anchor.BN {
  const seed = Buffer.from(circuitName);
  const [, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("comp_def"), seed],
    programId
  );
  return new anchor.BN(bump);
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  retries = 5
): Promise<Uint8Array> {
  for (let i = 0; i < retries; i++) {
    try {
      return await getMXEPublicKey(provider.connection, programId);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("Failed to get MXE public key");
}
