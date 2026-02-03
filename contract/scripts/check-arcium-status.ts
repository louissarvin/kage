import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getArciumProgramId,
} from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");
const ARCIUM_PROGRAM_ID = getArciumProgramId();

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  console.log("=== Checking Arcium Status ===");
  console.log("MXE Program ID:", PROGRAM_ID.toBase58());
  console.log("Arcium Program ID:", ARCIUM_PROGRAM_ID.toBase58());

  // Check MXE account
  const mxeAddress = getMXEAccAddress(PROGRAM_ID);
  console.log("\nMXE Account:", mxeAddress.toBase58());

  const mxeInfo = await connection.getAccountInfo(mxeAddress);
  if (mxeInfo) {
    console.log("MXE Account size:", mxeInfo.data.length);
    console.log("MXE Account owner:", mxeInfo.owner.toBase58());
  } else {
    console.log("MXE Account NOT FOUND!");
    return;
  }

  // Check mempool
  const mempoolAddress = getMempoolAccAddress(PROGRAM_ID);
  console.log("\nMempool Account:", mempoolAddress.toBase58());

  const mempoolInfo = await connection.getAccountInfo(mempoolAddress);
  if (mempoolInfo) {
    console.log("Mempool Account size:", mempoolInfo.data.length);
    console.log("Mempool Account owner:", mempoolInfo.owner.toBase58());
  } else {
    console.log("Mempool Account NOT FOUND!");
  }

  // Check executing pool
  const execPoolAddress = getExecutingPoolAccAddress(PROGRAM_ID);
  console.log("\nExecuting Pool Account:", execPoolAddress.toBase58());

  const execPoolInfo = await connection.getAccountInfo(execPoolAddress);
  if (execPoolInfo) {
    console.log("Exec Pool Account size:", execPoolInfo.data.length);
    console.log("Exec Pool Account owner:", execPoolInfo.owner.toBase58());
  } else {
    console.log("Exec Pool Account NOT FOUND!");
  }

  // Check comp defs
  console.log("\n=== Computation Definitions ===");
  const compDefs = ["store_meta_keys", "fetch_meta_keys"];

  for (const compDefName of compDefs) {
    const offset = getCompDefAccOffset(compDefName);
    const offsetNum = Buffer.from(offset).readUInt32LE();
    const compDefAddress = getCompDefAccAddress(PROGRAM_ID, offsetNum);
    console.log(`\n${compDefName}:`);
    console.log("  PDA:", compDefAddress.toBase58());
    console.log("  Offset:", offsetNum);

    const compDefInfo = await connection.getAccountInfo(compDefAddress);
    if (compDefInfo) {
      console.log("  Size:", compDefInfo.data.length);
      console.log("  Owner:", compDefInfo.owner.toBase58());

      // Try to decode basic info from data (first 8 bytes are discriminator)
      if (compDefInfo.data.length > 8) {
        console.log("  Discriminator:", compDefInfo.data.slice(0, 8).toString('hex'));
      }
    } else {
      console.log("  NOT FOUND!");
    }
  }
}

main().catch(console.error);
