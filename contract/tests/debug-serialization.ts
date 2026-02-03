/**
 * Debug script to test write_meta_keys_to_vault serialization
 *
 * This compares the serialization between the working test pattern and frontend pattern.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BorshInstructionCoder } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { randomBytes } from "crypto";
import {
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
import BN from "bn.js";

// Production program ID
const PROGRAM_ID = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");
const ARCIUM_CLUSTER_OFFSET = 456;

// Load production IDL
const idlPath = "/Users/macbookair/Documents/kage/frontend/src/lib/sdk/idl.json";
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

// Helper: Convert first 16 bytes to BigInt (little-endian)
function bytesToU128(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (let i = 0; i < 16 && i < bytes.length; i++) {
    value |= BigInt(bytes[i]) << (BigInt(i) * BigInt(8));
  }
  return value;
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

async function main() {
  // Set up connection and program
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(readKpJson(`${os.homedir()}/.config/solana/id.json`));
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = new Program(idl, provider);

  console.log("\n=== Debug Serialization Test ===");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Owner:", wallet.publicKey.toBase58());

  // Get MXE public key
  console.log("\nFetching MXE public key...");
  let mxePublicKey: Uint8Array;
  try {
    mxePublicKey = await getMXEPublicKey(provider, PROGRAM_ID);
    if (!mxePublicKey) throw new Error("MXE key is null");
    console.log("MXE public key obtained");
  } catch (e) {
    console.error("Failed to get MXE public key:", e);
    return;
  }

  // Generate test data
  const spendPrivBytes = randomBytes(32);
  const viewPrivBytes = randomBytes(32);
  const [spendLo, spendHi] = splitKeyToU128(spendPrivBytes);
  const [viewLo, viewHi] = splitKeyToU128(viewPrivBytes);

  // Client-side encryption
  const sessionPrivKey = x25519.utils.randomSecretKey();
  const sessionPubKey = x25519.getPublicKey(sessionPrivKey);
  const sharedSecret = x25519.getSharedSecret(sessionPrivKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const plaintext = [spendLo, spendHi, viewLo, viewHi];
  const userNonceBytes = randomBytes(16);
  const ciphertext = cipher.encrypt(plaintext, userNonceBytes);
  const mxeNonceBytes = randomBytes(16);

  // ============================================
  // Test serialization patterns
  // ============================================

  console.log("\n=== Serialization Comparison ===\n");

  // Use same random bytes for comparison
  const offsetBytes = randomBytes(8);

  // Pattern 1: Direct (working test)
  const computationOffset1 = new anchor.BN(offsetBytes, "le");
  const userNonce1 = new anchor.BN(deserializeLE(userNonceBytes).toString());
  const mxeNonce1 = new anchor.BN(deserializeLE(mxeNonceBytes).toString());

  // Pattern 2: Via string (frontend pattern)
  const computationOffset2 = new BN(new BN(offsetBytes, 'le').toString(), 10);
  const userNonce2 = new BN(new BN(deserializeLE(userNonceBytes).toString()).toString(), 10);
  const mxeNonce2 = new BN(new BN(deserializeLE(mxeNonceBytes).toString()).toString(), 10);

  console.log("Pattern 1 (Direct):");
  console.log("  computationOffset:", computationOffset1.toString());
  console.log("  userNonce:", userNonce1.toString());
  console.log("  mxeNonce:", mxeNonce1.toString());

  console.log("\nPattern 2 (Via String):");
  console.log("  computationOffset:", computationOffset2.toString());
  console.log("  userNonce:", userNonce2.toString());
  console.log("  mxeNonce:", mxeNonce2.toString());

  // Compare byte representations
  console.log("\n=== BN Byte Representations ===\n");

  console.log("computationOffset (u64 = 8 bytes):");
  console.log("  Pattern 1:", computationOffset1.toArrayLike(Buffer, 'le', 8).toString('hex'));
  console.log("  Pattern 2:", computationOffset2.toArrayLike(Buffer, 'le', 8).toString('hex'));

  console.log("\nuserNonce (u128 = 16 bytes):");
  console.log("  Pattern 1:", userNonce1.toArrayLike(Buffer, 'le', 16).toString('hex'));
  console.log("  Pattern 2:", userNonce2.toArrayLike(Buffer, 'le', 16).toString('hex'));
  console.log("  Match:", userNonce1.toArrayLike(Buffer, 'le', 16).equals(userNonce2.toArrayLike(Buffer, 'le', 16)));

  // ============================================
  // Build and compare instruction data
  // ============================================

  console.log("\n=== Instruction Data Comparison ===\n");

  // Create instruction coder
  const coder = new BorshInstructionCoder(idl);

  // Prepare args for Pattern 1
  const args1 = {
    computationOffset: computationOffset1,
    encryptedSpendLo: Array.from(ciphertext[0]),
    encryptedSpendHi: Array.from(ciphertext[1]),
    encryptedViewLo: Array.from(ciphertext[2]),
    encryptedViewHi: Array.from(ciphertext[3]),
    pubkey: Array.from(sessionPubKey),
    nonce: userNonce1,
    mxeNonce: mxeNonce1,
  };

  // Prepare args for Pattern 2
  const args2 = {
    computationOffset: computationOffset2,
    encryptedSpendLo: Array.from(ciphertext[0]),
    encryptedSpendHi: Array.from(ciphertext[1]),
    encryptedViewLo: Array.from(ciphertext[2]),
    encryptedViewHi: Array.from(ciphertext[3]),
    pubkey: Array.from(sessionPubKey),
    nonce: userNonce2,
    mxeNonce: mxeNonce2,
  };

  // Encode instructions (use snake_case as in IDL)
  const encoded1 = coder.encode("write_meta_keys_to_vault", args1);
  const encoded2 = coder.encode("write_meta_keys_to_vault", args2);

  console.log("Encoded instruction data (Pattern 1):", encoded1.toString('hex'));
  console.log("Encoded instruction data (Pattern 2):", encoded2.toString('hex'));
  console.log("\nData length Pattern 1:", encoded1.length, "bytes");
  console.log("Data length Pattern 2:", encoded2.length, "bytes");

  // Expected: 8 (discriminator) + 8 (u64) + 32*5 (arrays) + 16*2 (u128s) = 8 + 8 + 160 + 32 = 208 bytes
  console.log("Expected length: 208 bytes");

  // ============================================
  // Try actual transaction
  // ============================================

  console.log("\n=== Attempting Transaction ===\n");

  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("meta_keys_vault"), wallet.publicKey.toBuffer()],
    PROGRAM_ID
  );

  const compDefOffset = getCompDefAccOffset("store_meta_keys");
  const accounts = {
    payer: wallet.publicKey,
    owner: wallet.publicKey,
    metaKeysVault: vaultPDA,
    signPdaAccount: PublicKey.findProgramAddressSync(
      [Buffer.from("ArciumSignerAccount")],
      PROGRAM_ID
    )[0],
    mxeAccount: getMXEAccAddress(PROGRAM_ID),
    mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
    executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
    computationAccount: getComputationAccAddress(ARCIUM_CLUSTER_OFFSET, computationOffset2),
    compDefAccount: getCompDefAccAddress(PROGRAM_ID, Buffer.from(compDefOffset).readUInt32LE()),
    clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET),
    poolAccount: getFeePoolAccAddress(),
    clockAccount: getClockAccAddress(),
    systemProgram: anchor.web3.SystemProgram.programId,
    arciumProgram: getArciumProgramId(),
  };

  console.log("Accounts:");
  Object.entries(accounts).forEach(([k, v]) => {
    console.log(`  ${k}: ${v.toBase58()}`);
  });

  try {
    const sig = await program.methods
      .writeMetaKeysToVault(
        computationOffset2,
        Array.from(ciphertext[0]) as number[],
        Array.from(ciphertext[1]) as number[],
        Array.from(ciphertext[2]) as number[],
        Array.from(ciphertext[3]) as number[],
        Array.from(sessionPubKey) as number[],
        userNonce2,
        mxeNonce2
      )
      .accountsPartial(accounts)
      .rpc({ commitment: "confirmed" });

    console.log("\n✅ SUCCESS! Transaction:", sig);
  } catch (e: any) {
    console.error("\n❌ FAILED:", e.message);
    if (e.logs) {
      console.error("\nProgram logs:");
      e.logs.slice(-15).forEach((l: string) => console.error("  ", l));
    }
  }
}

main().catch(console.error);
