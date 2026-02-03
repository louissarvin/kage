import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { getCompDefAccOffset, getCompDefAccAddress, getArciumProgram } from "@arcium-hq/client";
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

  const circuits = ["store_meta_keys", "fetch_meta_keys"];

  console.log("=== Verifying Comp Def Hashes ===\n");

  for (const name of circuits) {
    const offset = getCompDefAccOffset(name);
    const offsetNum = Buffer.from(offset).readUInt32LE();
    const compDefPDA = getCompDefAccAddress(PROGRAM_ID, offsetNum);

    console.log(`--- ${name} ---`);
    console.log("PDA:", compDefPDA.toBase58());

    try {
      const compDefData = await arciumProgram.account.computationDefinitionAccount.fetch(compDefPDA);
      console.log("Status:", JSON.stringify(compDefData.state));

      // Check circuit source
      if (compDefData.circuitSourceInfo) {
        const source = compDefData.circuitSourceInfo;
        if (source.offChain) {
          console.log("Source Type: OffChain");
          console.log("URL:", source.offChain.source);
          // Hash is stored as [u8; 32]
          const hashBytes = source.offChain.hash;
          const hashHex = Buffer.from(hashBytes).toString('hex');
          console.log("Hash (on-chain):", hashHex);
        } else if (source.onChain) {
          console.log("Source Type: OnChain");
        }
      }
    } catch (e: any) {
      console.log("Error fetching:", e.message);
    }
    console.log();
  }

  // Expected hashes from local build
  console.log("=== Expected Hashes (from local build) ===");
  console.log("store_meta_keys: 17974a7a9fcddf4672ca5187fe942a51676f7dc74a070a7676b3a9acf585fe6f");
  console.log("fetch_meta_keys: a9f2d563d4175465ea590aee8b4e3853475acee1d41b0340ba7ec3ad2f55d606");
}

main().catch(console.error);
