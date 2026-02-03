import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { getMXEAccAddress, getArciumProgram, getArciumProgramId } from "@arcium-hq/client";
import * as os from "os";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");

function readKpJson(path: string) {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const payer = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  console.log("=== Checking MXE for New Program ===");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Arcium Program:", getArciumProgramId().toBase58());

  // Get client-derived address
  const clientMxeAddr = getMXEAccAddress(PROGRAM_ID);
  console.log("\nClient getMXEAccAddress:", clientMxeAddr.toBase58());

  // Try manual derivation (0.7.0 style)
  const ARCIUM_PROGRAM = getArciumProgramId();
  const seeds = [Buffer.from("MXEAccount"), PROGRAM_ID.toBuffer()];
  const [manualPda] = PublicKey.findProgramAddressSync(seeds, ARCIUM_PROGRAM);
  console.log("Manual PDA (MXEAccount + program):", manualPda.toBase58());

  // Check if client address exists
  const clientAcct = await connection.getAccountInfo(clientMxeAddr);
  console.log("\nClient address exists:", !!clientAcct);
  if (clientAcct) {
    console.log("  Owner:", clientAcct.owner.toBase58());
    console.log("  Size:", clientAcct.data.length);
  }

  // Check if manual address exists
  const manualAcct = await connection.getAccountInfo(manualPda);
  console.log("\nManual PDA exists:", !!manualAcct);
  if (manualAcct) {
    console.log("  Owner:", manualAcct.owner.toBase58());
    console.log("  Size:", manualAcct.data.length);
  }

  // Try to fetch via arcium program
  const arciumProgram = getArciumProgram(provider);
  try {
    const mxeData = await arciumProgram.account.mxeAccount.fetch(clientMxeAddr);
    console.log("\nMXE Account Data (via arcium program):");
    console.log("  lutOffsetSlot:", mxeData.lutOffsetSlot?.toString());
  } catch (e: any) {
    console.log("\nFailed to decode via arcium program:", e.message);
  }
}

main().catch(console.error);
