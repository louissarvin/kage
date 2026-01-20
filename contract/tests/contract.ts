import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { Contract } from "../target/types/contract";
import { randomBytes, createHash } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  buildFinalizeCompDefTx,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
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

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);
    return event;
  };

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

    await initCompDef(program, admin, "calculate_vested");
    console.log("calculate_vested computation definition initialized");

    await initCompDef(program, admin, "process_claim");
    console.log("process_claim computation definition initialized");

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
    const eventPromise = awaitEvent("organizationCreated");

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

    const event = await eventPromise;
    expect(event.admin.toString()).to.equal(admin.publicKey.toString());
    expect(Buffer.from(event.nameHash)).to.deep.equal(nameHash);
    expect(event.tokenMint.toString()).to.equal(tokenMint.toString());

    // Verify organization account
    const orgAccount = await program.account.organization.fetch(organizationPda);
    expect(orgAccount.admin.toString()).to.equal(admin.publicKey.toString());
    expect(orgAccount.scheduleCount.toNumber()).to.equal(0);
    expect(orgAccount.positionCount.toNumber()).to.equal(0);
    expect(orgAccount.isActive).to.equal(true);
  });

  it("Creates a vesting schedule", async () => {
    const orgAccount = await program.account.organization.fetch(organizationPda);
    const scheduleId = orgAccount.scheduleCount;

    [schedulePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_schedule"),
        organizationPda.toBuffer(),
        scheduleId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    const cliffDuration = new anchor.BN(30 * 24 * 60 * 60); // 30 days in seconds
    const totalDuration = new anchor.BN(365 * 24 * 60 * 60); // 1 year in seconds
    const vestingInterval = new anchor.BN(24 * 60 * 60); // 1 day in seconds

    const eventPromise = awaitEvent("vestingScheduleCreated");

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

    const event = await eventPromise;
    expect(event.organization.toString()).to.equal(organizationPda.toString());
    expect(event.cliffDuration.toNumber()).to.equal(cliffDuration.toNumber());
    expect(event.totalDuration.toNumber()).to.equal(totalDuration.toNumber());
    expect(event.vestingInterval.toNumber()).to.equal(vestingInterval.toNumber());

    // Verify schedule account
    const scheduleAccount = await program.account.vestingSchedule.fetch(schedulePda);
    expect(scheduleAccount.organization.toString()).to.equal(organizationPda.toString());
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

    // Derive sign PDA
    const [signPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sign_pda")],
      program.programId,
    );

    const eventPromise = awaitEvent("vestingPositionCreated");

    const sig = await program.methods
      .createVestingPosition(
        computationOffset,
        Array.from(beneficiaryCommitment),
        Array.from(ciphertext[0]),
        Array.from(publicKey),
        nonceAsBN,
      )
      .accountsPartial({
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
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("Create vesting position signature:", sig);

    // Wait for MPC computation to finalize
    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed",
    );
    console.log("Position computation finalized:", finalizeSig);

    const event = await eventPromise;
    expect(event.organization.toString()).to.equal(organizationPda.toString());
    expect(event.schedule.toString()).to.equal(schedulePda.toString());
    expect(event.positionId.toNumber()).to.equal(positionId.toNumber());
    expect(Buffer.from(event.beneficiaryCommitment)).to.deep.equal(beneficiaryCommitment);

    // Verify position account
    const positionAccount = await program.account.vestingPosition.fetch(positionPda);
    expect(positionAccount.organization.toString()).to.equal(organizationPda.toString());
    expect(positionAccount.schedule.toString()).to.equal(schedulePda.toString());
    expect(positionAccount.isActive).to.equal(true);
    expect(positionAccount.isFullyClaimed).to.equal(false);

    // Verify organization position count incremented
    const updatedOrg = await program.account.organization.fetch(organizationPda);
    expect(updatedOrg.positionCount.toNumber()).to.equal(1);
  });

  it("Calculates vested amount", async () => {
    const computationOffset = new anchor.BN(randomBytes(8), "hex");
    const nonce = randomBytes(16);
    const nonceAsBN = new anchor.BN(deserializeLE(nonce).toString());

    // Derive sign PDA
    const [signPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sign_pda")],
      program.programId,
    );

    const eventPromise = awaitEvent("vestedAmountCalculationQueued");

    const sig = await program.methods
      .calculateVestedAmount(
        computationOffset,
        Array.from(publicKey),
        nonceAsBN,
      )
      .accountsPartial({
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
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("Calculate vested amount signature:", sig);

    // Wait for MPC computation to finalize
    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed",
    );
    console.log("Vested calculation finalized:", finalizeSig);

    const event = await eventPromise;
    expect(event.position.toString()).to.equal(positionPda.toString());
    expect(event.computationOffset.toNumber()).to.equal(computationOffset.toNumber());

    console.log("Vested amount calculation queued successfully");
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

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId(),
  )[0];

  console.log(`Comp def PDA for ${circuitName}:`, compDefPDA.toString());

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

  // Finalize the computation definition
  const provider = anchor.getProvider();
  const finalizeTx = await buildFinalizeCompDefTx(
    provider as anchor.AnchorProvider,
    Buffer.from(offset).readUInt32LE(),
    program.programId,
  );

  const latestBlockhash = await provider.connection.getLatestBlockhash();
  finalizeTx.recentBlockhash = latestBlockhash.blockhash;
  finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
  finalizeTx.sign(owner);

  await provider.sendAndConfirm(finalizeTx);
  console.log(`Finalized ${circuitName} computation definition`);

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
