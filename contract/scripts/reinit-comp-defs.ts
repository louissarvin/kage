/**
 * Re-initialize computation definitions after contract upgrade
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AddressLookupTableProgram, PublicKey, Keypair, Connection } from "@solana/web3.js";
import {
  getCompDefAccOffset,
  getCompDefAccAddress,
  getMXEAccAddress,
  getArciumProgramId,
  getLookupTableAddress,
  getArciumProgram,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

// Standard Solana Address Lookup Table program
const LUT_PROGRAM_ID = AddressLookupTableProgram.programId;

const PROGRAM_ID = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");

// Load IDL
const idlPath = "/Users/macbookair/Documents/kage/frontend/src/lib/sdk/idl.json";
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const payer = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = new Program(idl, provider);

  // Get Arcium program and fetch MXE account for LUT offset
  const arciumProgram = getArciumProgram(provider);
  const mxeAccountAddr = getMXEAccAddress(PROGRAM_ID);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccountAddr);
  const lutPDA = getLookupTableAddress(PROGRAM_ID, mxeAcc.lutOffsetSlot);

  console.log("=== Re-initializing Computation Definitions ===");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Payer:", payer.publicKey.toBase58());
  console.log("LUT Offset Slot:", mxeAcc.lutOffsetSlot.toString());
  console.log("LUT PDA:", lutPDA.toBase58());

  const compDefs = [
    "store_meta_keys",
    "fetch_meta_keys",
  ];

  for (const compDefName of compDefs) {
    console.log(`\n--- ${compDefName} ---`);

    const compDefOffset = getCompDefAccOffset(compDefName);
    const compDefOffsetNum = Buffer.from(compDefOffset).readUInt32LE();
    const compDefPDA = getCompDefAccAddress(PROGRAM_ID, compDefOffsetNum);

    console.log("Comp Def PDA:", compDefPDA.toBase58());
    console.log("LUT PDA:", lutPDA.toBase58());

    // Check if comp def exists
    const existingAccount = await connection.getAccountInfo(compDefPDA);
    if (existingAccount) {
      console.log("Comp def already exists, size:", existingAccount.data.length);
      console.log("Skipping (already initialized)");
      continue;
    }

    // Initialize
    const methodName = compDefName === "store_meta_keys"
      ? "initStoreMetaKeysCompDef"
      : "initFetchMetaKeysCompDef";

    console.log(`Calling ${methodName}...`);

    try {
      const sig = await (program.methods as any)[methodName]()
        .accountsPartial({
          payer: payer.publicKey,
          mxeAccount: getMXEAccAddress(PROGRAM_ID),
          compDefAccount: compDefPDA,
          addressLookupTable: lutPDA,
          lutProgram: LUT_PROGRAM_ID,
          arciumProgram: getArciumProgramId(),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([payer])
        .rpc({ commitment: "confirmed" });

      console.log("✅ Success:", sig);
    } catch (e: any) {
      console.error("❌ Failed:", e.message);
      if (e.logs) {
        console.error("Logs:", e.logs.slice(-10));
      }
    }
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
