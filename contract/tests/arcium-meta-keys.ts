/**
 * ShadowVest Arcium Meta-Keys Storage Tests
 *
 * Tests the MPC-encrypted meta-keys storage flow:
 * 1. Initialize computation definitions
 * 2. Generate employee stealth meta-keys
 * 3. Encrypt and store via write_meta_keys_to_vault
 * 4. Wait for MPC computation
 * 5. Read back via read_meta_keys_from_vault
 * 6. Decrypt and verify keys match
 */

import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { Contract } from "../target/types/contract";
import { randomBytes } from "crypto";
import {
  getArciumEnv,
  getArciumProgramId,
  getCompDefAccOffset,
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
  RescueCipher,
  deserializeLE,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

// Import stealth address utilities for key generation
import { generateStealthMetaKeys, StealthMetaKeys } from "../lib/stealth-address";

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
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
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

// Helper: Convert first 16 bytes to BigInt (little-endian)
function bytesToU128(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (let i = 0; i < 16 && i < bytes.length; i++) {
    value |= BigInt(bytes[i]) << (BigInt(i) * BigInt(8));
  }
  return value;
}

// Helper: Convert BigInt to 16-byte array (little-endian)
function u128ToBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(16);
  let temp = value;
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number(temp & BigInt(0xff));
    temp >>= BigInt(8);
  }
  return bytes;
}

// Helper: Split 32-byte key into two u128 values (lo, hi)
function splitKeyToU128(key: Uint8Array): [bigint, bigint] {
  if (key.length !== 32) {
    throw new Error("Key must be 32 bytes");
  }
  const lo = bytesToU128(key.slice(0, 16));
  const hi = bytesToU128(key.slice(16, 32));
  return [lo, hi];
}

// Helper: Reconstruct 32-byte key from two u128 values
function reconstructKeyFromU128(lo: bigint, hi: bigint): Uint8Array {
  const loBytes = u128ToBytes(lo);
  const hiBytes = u128ToBytes(hi);
  const key = new Uint8Array(32);
  key.set(loBytes, 0);
  key.set(hiBytes, 16);
  return key;
}

describe("Arcium Meta-Keys Storage", () => {
  // Configure provider
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Contract as Program<Contract>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const arciumEnv = getArciumEnv();

  // Test accounts
  let owner: Keypair;
  let mxePublicKey: Uint8Array;
  let employeeMetaKeys: StealthMetaKeys;

  // Store original keys for verification
  let originalSpendPriv: Uint8Array;
  let originalViewPriv: Uint8Array;


  before(async () => {
    owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    console.log("\n=== Arcium Meta-Keys Storage Test ===");
    console.log("Owner:", owner.publicKey.toBase58());
    console.log("Program ID:", program.programId.toBase58());

    // Get MXE public key
    console.log("\nFetching MXE public key...");
    mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
    console.log("MXE x25519 pubkey:", Buffer.from(mxePublicKey).toString("hex").slice(0, 32) + "...");

    // Generate stealth meta-keys
    employeeMetaKeys = generateStealthMetaKeys();
    originalSpendPriv = Buffer.from(employeeMetaKeys.spendPrivKey, "hex");
    originalViewPriv = Buffer.from(employeeMetaKeys.viewPrivKey, "hex");

    console.log("\n🔑 Generated stealth meta-keys:");
    console.log("  Spend pubkey:", employeeMetaKeys.metaAddress.spendPubkey);
    console.log("  View pubkey:", employeeMetaKeys.metaAddress.viewPubkey);
    console.log("  Spend priv (hex):", employeeMetaKeys.spendPrivKey.slice(0, 32) + "...");
    console.log("  View priv (hex):", employeeMetaKeys.viewPrivKey.slice(0, 32) + "...");
  });

  describe("1. Initialize Computation Definitions", () => {
    it("Initializes store_meta_keys comp def", async () => {
      const compDefOffset = getCompDefAccOffset("store_meta_keys");
      const compDefPDA = getCompDefAccAddress(program.programId, Buffer.from(compDefOffset).readUInt32LE());

      const existingAccount = await provider.connection.getAccountInfo(compDefPDA);
      if (existingAccount) {
        console.log("✓ store_meta_keys comp def already exists");
        return;
      }

      console.log("\nInitializing store_meta_keys computation definition...");
      const sig = await program.methods
        .initStoreMetaKeysCompDef()
        .accountsStrict({
          payer: owner.publicKey,
          mxeAccount: getMXEAccAddress(program.programId),
          compDefAccount: compDefPDA,
          arciumProgram: getArciumProgramId(),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });

      console.log("✓ store_meta_keys comp def initialized:", sig);
    });

    it("Initializes fetch_meta_keys comp def", async () => {
      const compDefOffset = getCompDefAccOffset("fetch_meta_keys");
      const compDefPDA = getCompDefAccAddress(program.programId, Buffer.from(compDefOffset).readUInt32LE());

      const existingAccount = await provider.connection.getAccountInfo(compDefPDA);
      if (existingAccount) {
        console.log("✓ fetch_meta_keys comp def already exists");
        return;
      }

      console.log("\nInitializing fetch_meta_keys computation definition...");
      const sig = await program.methods
        .initFetchMetaKeysCompDef()
        .accountsStrict({
          payer: owner.publicKey,
          mxeAccount: getMXEAccAddress(program.programId),
          compDefAccount: compDefPDA,
          arciumProgram: getArciumProgramId(),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });

      console.log("✓ fetch_meta_keys comp def initialized:", sig);
    });
  });

  describe("2. Write Meta-Keys to Vault", () => {
    it("Encrypts and stores meta-keys via MPC", async () => {
      console.log("\n📝 Writing meta-keys to vault...");

      // Split 32-byte keys into lo/hi u128 pairs
      const [spendLo, spendHi] = splitKeyToU128(originalSpendPriv);
      const [viewLo, viewHi] = splitKeyToU128(originalViewPriv);

      console.log("\n📊 Split keys into u128 pairs:");
      console.log("  spendLo:", spendLo.toString(16).slice(0, 16) + "...");
      console.log("  spendHi:", spendHi.toString(16).slice(0, 16) + "...");
      console.log("  viewLo:", viewLo.toString(16).slice(0, 16) + "...");
      console.log("  viewHi:", viewHi.toString(16).slice(0, 16) + "...");

      // Client-side encryption with x25519
      const sessionPrivKey = x25519.utils.randomSecretKey();
      const sessionPubKey = x25519.getPublicKey(sessionPrivKey);
      const sharedSecret = x25519.getSharedSecret(sessionPrivKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);

      // Encrypt all 4 u128 values
      const plaintext = [spendLo, spendHi, viewLo, viewHi];
      const userNonce = randomBytes(16);
      const ciphertext = cipher.encrypt(plaintext, userNonce);

      // Generate MXE nonce for re-encryption
      const mxeNonce = randomBytes(16);

      console.log("\n🔒 Encrypted meta-keys for MPC");

      // Computation parameters
      const computationOffset = new anchor.BN(randomBytes(8), "le");

      // Derive vault PDA
      const [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("meta_keys_vault"), owner.publicKey.toBuffer()],
        program.programId
      );
      console.log("Vault PDA:", vaultPDA.toBase58());

      // Build accounts
      const compDefOffset = getCompDefAccOffset("store_meta_keys");
      const accounts = {
        payer: owner.publicKey,
        owner: owner.publicKey,
        metaKeysVault: vaultPDA,
        signPdaAccount: PublicKey.findProgramAddressSync(
          [Buffer.from("ArciumSignerAccount")],
          program.programId
        )[0],
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(compDefOffset).readUInt32LE()),
        clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
        arciumProgram: getArciumProgramId(),
      };

      console.log("\n⏳ Queuing write computation...");
      console.log("Computation offset:", computationOffset.toString());
      console.log("Accounts:", JSON.stringify({
        payer: accounts.payer.toBase58(),
        owner: accounts.owner.toBase58(),
        metaKeysVault: accounts.metaKeysVault.toBase58(),
        signPdaAccount: accounts.signPdaAccount.toBase58(),
        mxeAccount: accounts.mxeAccount.toBase58(),
        mempoolAccount: accounts.mempoolAccount.toBase58(),
        executingPool: accounts.executingPool.toBase58(),
        computationAccount: accounts.computationAccount.toBase58(),
        compDefAccount: accounts.compDefAccount.toBase58(),
        clusterAccount: accounts.clusterAccount.toBase58(),
      }, null, 2));

      let queueSig: string;
      try {
        queueSig = await program.methods
          .writeMetaKeysToVault(
            computationOffset,
            Array.from(ciphertext[0]) as number[],
            Array.from(ciphertext[1]) as number[],
            Array.from(ciphertext[2]) as number[],
            Array.from(ciphertext[3]) as number[],
            Array.from(sessionPubKey) as number[],
            new anchor.BN(deserializeLE(userNonce).toString()),
            new anchor.BN(deserializeLE(mxeNonce).toString())
          )
          .accountsPartial(accounts)
          .signers([owner])
          .rpc({ commitment: "confirmed" });

        console.log("✓ Queue transaction:", queueSig);
      } catch (e: any) {
        console.error("Transaction failed!");
        console.error("Error:", e.message);
        if (e.logs) {
          console.error("Logs:", e.logs);
        }
        throw e;
      }

      // Wait for MPC callback by polling vault account state
      console.log("⏳ Waiting for store_meta_keys callback (polling vault state)...");
      await waitForAccountState(
        provider,
        program,
        vaultPDA,
        "metaKeysVault",
        (account: any) => account.isInitialized === true,
        300000,
      );
      console.log("✓ Vault initialized by MPC callback");

      // Verify vault was created
      const vaultAccount = await program.account.metaKeysVault.fetch(vaultPDA);
      console.log("\n✅ Meta-keys stored successfully!");
      console.log("  Vault owner:", vaultAccount.owner.toBase58());
      console.log("  Is initialized:", vaultAccount.isInitialized);
      console.log("  Ciphertexts stored:", vaultAccount.ciphertexts.length);

      expect(vaultAccount.isInitialized).to.be.true;
      expect(vaultAccount.ciphertexts.length).to.equal(4);
    });
  });

  describe("3. Read Meta-Keys from Vault", () => {
    it("Reads and decrypts meta-keys via MPC", async () => {
      console.log("\n📖 Reading meta-keys from vault...");

      // Create new session key for receiving
      const sessionPrivKey = x25519.utils.randomSecretKey();
      const sessionPubKey = x25519.getPublicKey(sessionPrivKey);
      const sessionNonce = randomBytes(16);

      console.log("🔑 New session key for reading");

      // Derive vault PDA
      const [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("meta_keys_vault"), owner.publicKey.toBuffer()],
        program.programId
      );

      const computationOffset = new anchor.BN(randomBytes(8), "le");

      // Build accounts
      const compDefOffset = getCompDefAccOffset("fetch_meta_keys");
      const accounts = {
        payer: owner.publicKey,
        owner: owner.publicKey,
        metaKeysVault: vaultPDA,
        signPdaAccount: PublicKey.findProgramAddressSync(
          [Buffer.from("ArciumSignerAccount")],
          program.programId
        )[0],
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(compDefOffset).readUInt32LE()),
        clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
        arciumProgram: getArciumProgramId(),
      };

      // Set up event listener BEFORE queuing to avoid race condition
      // (MPC callback fires within ~2 seconds)
      let metaKeysEvent: any = null;
      let eventListenerId: number;
      const eventPromise = new Promise<any>((resolve) => {
        eventListenerId = program.addEventListener("metaKeysRetrieved" as any, (event: any) => {
          metaKeysEvent = event;
          resolve(event);
        });
      });

      console.log("⏳ Queuing read computation...");
      const queueSig = await program.methods
        .readMetaKeysFromVault(
          computationOffset,
          Array.from(sessionPubKey) as number[],
          new anchor.BN(deserializeLE(sessionNonce).toString())
        )
        .accountsPartial(accounts)
        .signers([owner])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log("✓ Queue transaction:", queueSig);

      const computationPDA = getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset);

      console.log("⏳ Waiting for fetch_meta_keys callback...");

      // Wait for event via WebSocket (primary) or poll signatures (fallback)
      const timeoutMs = 300000;
      const startTime = Date.now();

      while (!metaKeysEvent && Date.now() - startTime < timeoutMs) {
        // Try getSignaturesForAddress as fallback
        try {
          const sigs = await provider.connection.getSignaturesForAddress(computationPDA, { limit: 10 });
          const eventParser = new anchor.EventParser(program.programId, program.coder);
          for (const sigInfo of sigs) {
            if (sigInfo.err || sigInfo.signature === queueSig) continue;
            const tx = await provider.connection.getTransaction(sigInfo.signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            });
            if (tx?.meta?.logMessages) {
              for (const event of eventParser.parseLogs(tx.meta.logMessages)) {
                if (event.name === "MetaKeysRetrieved" || event.name === "metaKeysRetrieved") {
                  metaKeysEvent = event.data;
                  break;
                }
              }
              if (metaKeysEvent) break;
            }
          }
        } catch (err) {
          // Ignore and retry
        }

        if (!metaKeysEvent) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          if (elapsed % 30 === 0 && elapsed > 0) {
            console.log(`  Still waiting for callback... (${elapsed}s elapsed)`);
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      // Clean up listener
      try { await program.removeEventListener(eventListenerId!); } catch {}

      if (!metaKeysEvent) {
        throw new Error("MetaKeysRetrieved event not found after timeout");
      }

      console.log("\n📨 Received MetaKeysRetrieved event");
      console.log("  Owner:", metaKeysEvent.owner.toBase58());
      console.log("  Vault:", metaKeysEvent.vault.toBase58());

      // Decrypt with session key
      const sharedSecret = x25519.getSharedSecret(sessionPrivKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);

      const decrypted = cipher.decrypt(
        [
          new Uint8Array(metaKeysEvent.encryptedSpendLo),
          new Uint8Array(metaKeysEvent.encryptedSpendHi),
          new Uint8Array(metaKeysEvent.encryptedViewLo),
          new Uint8Array(metaKeysEvent.encryptedViewHi),
        ],
        new Uint8Array(metaKeysEvent.nonce)
      );

      // Reconstruct full 32-byte keys
      const recoveredSpendPriv = reconstructKeyFromU128(decrypted[0], decrypted[1]);
      const recoveredViewPriv = reconstructKeyFromU128(decrypted[2], decrypted[3]);

      console.log("\n✅ Meta-keys decrypted successfully!");
      console.log("  Recovered spend priv:", Buffer.from(recoveredSpendPriv).toString("hex").slice(0, 32) + "...");
      console.log("  Recovered view priv:", Buffer.from(recoveredViewPriv).toString("hex").slice(0, 32) + "...");

      // Verify keys match original
      const spendMatches = Buffer.from(recoveredSpendPriv).equals(Buffer.from(originalSpendPriv));
      const viewMatches = Buffer.from(recoveredViewPriv).equals(Buffer.from(originalViewPriv));

      console.log("\n🔍 Verification:");
      console.log("  Spend key matches:", spendMatches);
      console.log("  View key matches:", viewMatches);

      expect(spendMatches).to.be.true;
      expect(viewMatches).to.be.true;

      console.log("\n✅ All keys verified! MPC meta-keys storage working correctly.");
    });
  });
});

// ============================================================
// Helper Functions
// ============================================================

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
      // Account might not exist yet
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed % 30 === 0 && elapsed > 0) {
      console.log(`  Still waiting for ${accountName} state change... (${elapsed}s elapsed)`);
    }
  }

  throw new Error(`Timeout waiting for ${accountName} state change after ${timeoutMs / 1000}s`);
}

