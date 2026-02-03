import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { getMXEAccAddress, getArciumProgram } from "@arcium-hq/client";
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

  const arciumProgram = getArciumProgram(provider);
  const mxeAddr = getMXEAccAddress(PROGRAM_ID);

  console.log("=== MXE Account Details ===");
  console.log("MXE Address:", mxeAddr.toBase58());

  const mxeData = await arciumProgram.account.mxeAccount.fetch(mxeAddr);
  console.log("\nMXE Account Data:");
  console.log(JSON.stringify(mxeData, (k, v) => {
    if (v && typeof v === 'object' && v.toBase58) return v.toBase58();
    if (typeof v === 'bigint') return v.toString();
    if (v && v.constructor?.name === 'BN') return v.toString();
    return v;
  }, 2));
}

main().catch(console.error);
