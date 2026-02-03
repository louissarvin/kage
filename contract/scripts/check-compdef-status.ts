import { Connection, PublicKey } from "@solana/web3.js";
import { getCompDefAccAddress, getCompDefAccOffset } from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  for (const name of ["store_meta_keys", "fetch_meta_keys"]) {
    const offset = Buffer.from(getCompDefAccOffset(name)).readUInt32LE();
    const compDefPDA = getCompDefAccAddress(PROGRAM_ID, offset);
    
    console.log(`\n=== ${name} ===`);
    console.log("PDA:", compDefPDA.toBase58());
    
    const info = await connection.getAccountInfo(compDefPDA);
    if (info) {
      const data = info.data;
      console.log("Data length:", data.length);
      console.log("First 100 bytes (hex):", data.slice(0, 100).toString('hex'));
      
      // ComputationDefinitionAccount layout (approximate):
      // 8 bytes: discriminator
      // 8 bytes: offset 
      // 4 bytes: state (enum)
      // ... circuit source data
      const stateOffset = 8 + 8; // after discriminator and offset
      const stateValue = data.readUInt32LE(stateOffset);
      console.log("State value at offset 16:", stateValue);
      console.log("State meanings: 0=Initializing, 1=Uploading, 2=Finalizing, 3=Finalized");
    }
  }
}

main().catch(console.error);
