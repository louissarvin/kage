import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { initMxePart2, getArciumEnv, getArciumProgram } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import BN from "bn.js";

const PROGRAM_ID = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");

// The actual MXE account address from the Part 1 transaction
const MXE_ACCOUNT = new PublicKey("Dxxup8spGmAV9cmbdiXaQBrtpvoJtNBnH5JQt9HDznUi");

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const payer = readKpJson(os.homedir() + "/.config/solana/id.json");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    skipPreflight: true  // Try to skip simulation
  });

  const arciumEnv = getArciumEnv();
  console.log("=== Initializing MXE Part 2 ===");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("MXE Account:", MXE_ACCOUNT.toBase58());
  console.log("Cluster Offset:", arciumEnv.arciumClusterOffset);
  console.log("Payer:", payer.publicKey.toBase58());

  // Check current MXE account state
  const arciumProgram = getArciumProgram(provider);
  try {
    const mxeData = await connection.getAccountInfo(MXE_ACCOUNT);
    if (mxeData) {
      console.log("\nMXE Account exists, size:", mxeData.data.length);
      // First 8 bytes are discriminator, next fields would be lutOffsetSlot etc
      const dataView = new DataView(mxeData.data.buffer, mxeData.data.byteOffset);
      // After 8-byte discriminator: lut_offset_slot is i64 (8 bytes)
      const lutOffsetSlot = dataView.getBigInt64(8, true);
      console.log("LUT Offset Slot:", lutOffsetSlot.toString());
    }
  } catch (e: any) {
    console.log("Failed to read MXE account:", e.message);
  }

  console.log("\nInitializing MXE Part 2...");
  // initMxePart2(provider, clusterOffset, mxeProgramId, recoveryPeers[], keygenOffset, keyRecoveryInitOffset, lutOffset)
  const recoveryPeers = [0, 1, 2, 3]; // 4 peers for devnet
  const keygenOffset = new BN(0);
  const keyRecoveryInitOffset = new BN(0);
  const lutOffset = new BN(1);  // Try a different offset

  try {
    const sig = await initMxePart2(
      provider,
      arciumEnv.arciumClusterOffset,
      PROGRAM_ID,
      recoveryPeers,
      keygenOffset,
      keyRecoveryInitOffset,
      lutOffset
    );
    console.log("Part 2 signature:", sig);
  } catch (e: any) {
    console.error("Part 2 error:", e.message);
    if (e.logs) {
      console.error("Logs:", e.logs.slice(-15));
    }
    throw e;
  }

  console.log("\n=== MXE Part 2 Complete ===");
}

main().catch(console.error);
