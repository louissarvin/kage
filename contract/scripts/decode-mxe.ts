import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { getArciumProgram } from "@arcium-hq/client";
import * as os from "os";
import * as fs from "fs";

const MXE_ACCOUNT = new PublicKey("Dxxup8spGmAV9cmbdiXaQBrtpvoJtNBnH5JQt9HDznUi");

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

  console.log("=== Decoding MXE Account ===");
  console.log("Address:", MXE_ACCOUNT.toBase58());

  try {
    // Try to fetch using the arcium program's account decoder
    const mxeData = await arciumProgram.account.mxeAccount.fetch(MXE_ACCOUNT);
    console.log("\nMXE Account Data:");
    console.log("- lutOffsetSlot:", mxeData.lutOffsetSlot?.toString());
    console.log("- publicKey:", mxeData.publicKey?.toString());
    console.log("- all fields:", JSON.stringify(mxeData, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  } catch (e: any) {
    console.error("Failed to decode with arcium program:", e.message);

    // Try raw fetch and manual decode
    console.log("\nTrying raw fetch...");
    const accountInfo = await connection.getAccountInfo(MXE_ACCOUNT);
    if (accountInfo) {
      console.log("Account size:", accountInfo.data.length);
      console.log("Owner:", accountInfo.owner.toBase58());

      // First 8 bytes are discriminator
      const discriminator = accountInfo.data.slice(0, 8);
      console.log("Discriminator:", Buffer.from(discriminator).toString('hex'));

      // Try to read some fields manually
      // Based on typical MXE account layout:
      // - 8 bytes: discriminator
      // - 8 bytes: lut_offset_slot (i64)
      // - 32 bytes: public_key
      // etc.
      const dv = new DataView(accountInfo.data.buffer, accountInfo.data.byteOffset);
      const lutOffsetSlot = Number(dv.getBigInt64(8, true));
      console.log("\nManual parse:");
      console.log("- lutOffsetSlot (offset 8):", lutOffsetSlot);

      // Try reading more fields
      const pk = accountInfo.data.slice(16, 48);
      console.log("- publicKey bytes (offset 16-48):", Buffer.from(pk).toString('hex'));
    }
  }
}

main().catch(console.error);
