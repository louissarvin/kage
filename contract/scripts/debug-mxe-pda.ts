import { PublicKey } from "@solana/web3.js";
import { getMXEAccAddress, getArciumProgramId, getArciumEnv } from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");

console.log("Program ID:", PROGRAM_ID.toBase58());
console.log("Arcium Program ID:", getArciumProgramId().toBase58());

const env = getArciumEnv();
console.log("Arcium Env:", env);

// Get the MXE address using client
const mxeAddr = getMXEAccAddress(PROGRAM_ID);
console.log("getMXEAccAddress result:", mxeAddr.toBase58());

// Try to derive manually with exact seed from source
const ARCIUM_PROGRAM = getArciumProgramId();

// From source: const MXE_ACCOUNT_SEED = 'MXEAccount';
const seeds1 = [Buffer.from("MXEAccount"), PROGRAM_ID.toBuffer()];
const [pda1] = PublicKey.findProgramAddressSync(seeds1, ARCIUM_PROGRAM);
console.log("Manual PDA (MXEAccount + program):", pda1.toBase58());

// Also check what the tx shows as mxeProgramId input
const TX_MXE_PROGRAM = new PublicKey("6KLNfkNWdqPCdzPVMivEHSt3FR2NLnHX4w1T76kiFqp2");
const seeds2 = [Buffer.from("MXEAccount"), TX_MXE_PROGRAM.toBuffer()];
const [pda2] = PublicKey.findProgramAddressSync(seeds2, ARCIUM_PROGRAM);
console.log("Manual PDA with TX mxeProgramId:", pda2.toBase58());

// The actual account from transaction
console.log("\nActual MXE account from tx:", "Dxxup8spGmAV9cmbdiXaQBrtpvoJtNBnH5JQt9HDznUi");

// Both should match the same
console.log("\nThey match:", pda1.toBase58() === "Dxxup8spGmAV9cmbdiXaQBrtpvoJtNBnH5JQt9HDznUi");
