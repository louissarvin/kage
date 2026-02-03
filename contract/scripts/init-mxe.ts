import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { initMxePart1, initMxePart2, getArciumEnv } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import BN from "bn.js";

const PROGRAM_ID = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const payer = readKpJson(os.homedir() + "/.config/solana/id.json");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const arciumEnv = getArciumEnv();
  console.log("=== Initializing MXE ===");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Cluster Offset:", arciumEnv.arciumClusterOffset);
  console.log("Payer:", payer.publicKey.toBase58());

  try {
    console.log("\nInitializing MXE Part 1...");
    // initMxePart1(provider, mxeProgramId)
    const sig1 = await initMxePart1(provider, PROGRAM_ID);
    console.log("Part 1 signature:", sig1);
  } catch (e: any) {
    if (e.message?.includes("already in use") || e.message?.includes("0x0")) {
      console.log("MXE Part 1 already initialized");
    } else {
      console.error("Part 1 error:", e.message);
      throw e;
    }
  }

  try {
    console.log("\nInitializing MXE Part 2...");
    // initMxePart2(provider, clusterOffset, mxeProgramId, recoveryPeers[], keygenOffset, keyRecoveryInitOffset, lutOffset, mxeAuthority?)
    const recoveryPeers = [0, 1, 2, 3]; // 4 peers for devnet
    const keygenOffset = new BN(0);
    const keyRecoveryInitOffset = new BN(0);
    const lutOffset = new BN(0);
    const sig2 = await initMxePart2(
      provider,
      arciumEnv.arciumClusterOffset,
      PROGRAM_ID,
      recoveryPeers,
      keygenOffset,
      keyRecoveryInitOffset,
      lutOffset
    );
    console.log("Part 2 signature:", sig2);
  } catch (e: any) {
    if (e.message?.includes("already in use") || e.message?.includes("0x0")) {
      console.log("MXE Part 2 already initialized");
    } else {
      console.error("Part 2 error:", e.message);
      throw e;
    }
  }

  console.log("\n=== MXE Initialization Complete ===");
}

main().catch(console.error);
