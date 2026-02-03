import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { uploadCircuit, getArciumEnv } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

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
  console.log("Arcium Env:", arciumEnv);
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Payer:", payer.publicKey.toBase58());

  const circuits = ["store_meta_keys", "fetch_meta_keys"];

  for (const circuitName of circuits) {
    console.log(`\n=== Uploading ${circuitName} ===`);
    const circuitPath = `build/${circuitName}.arcis`;

    if (!fs.existsSync(circuitPath)) {
      console.log(`Circuit file not found: ${circuitPath}`);
      continue;
    }

    console.log(`Circuit path: ${circuitPath}`);
    const circuitData = fs.readFileSync(circuitPath);
    console.log(`Circuit size: ${circuitData.length} bytes`);

    try {
      // uploadCircuit(provider, circuitName, mxeProgramId, rawCircuit, logging?, chunkSize?)
      const result = await uploadCircuit(
        provider,
        circuitName,
        PROGRAM_ID,
        new Uint8Array(circuitData),
        true  // logging
      );
      console.log("Upload result:", result);
    } catch (e: any) {
      console.error("Upload error:", e.message);
      if (e.logs) console.error("Logs:", e.logs.slice(-5));
    }
  }
}

main().catch(console.error);
