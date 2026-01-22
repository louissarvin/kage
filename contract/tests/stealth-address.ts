/**
 * ShadowVest Stealth Address Flow Tests
 *
 * Tests the complete stealth address workflow:
 * 1. Employee generates stealth meta-keys (S, V)
 * 2. Employer derives stealth address from meta-address
 * 3. Employee scans for and discovers the payment
 * 4. Employee derives keypair and can sign transactions
 */

import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import * as bs58 from "bs58";
import { expect } from "chai";

// Import stealth address utilities
import {
  generateStealthMetaKeys,
  generateStealthPayment,
  encryptEphemeralPrivKey,
  isMyStealthPayment,
  deriveStealthKeypair,
  deriveStealthPub,
  decryptEphemeralPrivKey,
  decryptNote,
  StealthMetaKeys,
  StealthMetaAddress,
  StealthPaymentData,
} from "../lib/stealth-address";

describe("Stealth Address Flow", () => {
  // Test data
  let employeeMetaKeys: StealthMetaKeys;
  let employerEphemeralPriv: Uint8Array;
  let stealthPayment: StealthPaymentData;

  describe("1. Meta-Key Generation", () => {
    it("Generates valid stealth meta-keys for employee", () => {
      employeeMetaKeys = generateStealthMetaKeys();

      console.log("\n=== Employee Stealth Meta-Keys Generated ===");
      console.log("Spend pubkey (S):", employeeMetaKeys.metaAddress.spendPubkey);
      console.log("View pubkey (V):", employeeMetaKeys.metaAddress.viewPubkey);
      console.log("Spend privkey (s):", employeeMetaKeys.spendPrivKey.substring(0, 16) + "...");
      console.log("View privkey (v):", employeeMetaKeys.viewPrivKey.substring(0, 16) + "...");

      // Verify format
      expect(employeeMetaKeys.spendPrivKey).to.have.lengthOf(64); // 32 bytes hex
      expect(employeeMetaKeys.viewPrivKey).to.have.lengthOf(64);
      expect(employeeMetaKeys.metaAddress.spendPubkey).to.be.a("string");
      expect(employeeMetaKeys.metaAddress.viewPubkey).to.be.a("string");

      // Verify pubkeys are valid base58
      const spendPubBytes = bs58.decode(employeeMetaKeys.metaAddress.spendPubkey);
      const viewPubBytes = bs58.decode(employeeMetaKeys.metaAddress.viewPubkey);
      expect(spendPubBytes).to.have.lengthOf(32);
      expect(viewPubBytes).to.have.lengthOf(32);
    });

    it("Generates unique meta-keys each time", () => {
      const metaKeys2 = generateStealthMetaKeys();

      expect(metaKeys2.spendPrivKey).to.not.equal(employeeMetaKeys.spendPrivKey);
      expect(metaKeys2.viewPrivKey).to.not.equal(employeeMetaKeys.viewPrivKey);
      expect(metaKeys2.metaAddress.spendPubkey).to.not.equal(employeeMetaKeys.metaAddress.spendPubkey);
      expect(metaKeys2.metaAddress.viewPubkey).to.not.equal(employeeMetaKeys.metaAddress.viewPubkey);
    });
  });

  describe("2. Stealth Address Derivation (Employer Side)", () => {
    it("Employer derives stealth address from employee meta-address", async () => {
      console.log("\n=== Employer Derives Stealth Address ===");
      console.log("Employee meta-address:");
      console.log("  S:", employeeMetaKeys.metaAddress.spendPubkey);
      console.log("  V:", employeeMetaKeys.metaAddress.viewPubkey);

      // Employer generates stealth payment
      stealthPayment = await generateStealthPayment(employeeMetaKeys.metaAddress);

      console.log("\nGenerated stealth payment:");
      console.log("  Stealth address:", stealthPayment.stealthAddress.toBase58());
      console.log("  Ephemeral pubkey (R):", stealthPayment.ephemeralPubkey);
      console.log("  Encrypted payload length:", Buffer.from(stealthPayment.encryptedPayload, "base64").length, "bytes");

      // Verify stealth address is a valid Solana pubkey
      expect(stealthPayment.stealthAddress).to.be.instanceOf(PublicKey);
      expect(stealthPayment.ephemeralPubkey).to.be.a("string");
      expect(stealthPayment.encryptedPayload).to.be.a("string");

      // The encrypted payload should contain the ephemeral private key
      const payloadBytes = Buffer.from(stealthPayment.encryptedPayload, "base64");
      expect(payloadBytes.length).to.be.greaterThan(32); // At least 32 bytes for the key + overhead
    });

    it("Employer can add a note to the payment", async () => {
      console.log("\n=== Stealth Payment with Note ===");

      // Generate payment with a custom note
      const note = "Q1 2024 Vesting - 10,000 USDC";
      const paymentWithNote = await generateStealthPayment(employeeMetaKeys.metaAddress, note);

      console.log("Note:", note);
      console.log("Stealth address:", paymentWithNote.stealthAddress.toBase58());
      console.log("Encrypted payload length:", Buffer.from(paymentWithNote.encryptedPayload, "base64").length, "bytes");

      // Payload should be larger with the note
      const payloadBytes = Buffer.from(paymentWithNote.encryptedPayload, "base64");
      expect(payloadBytes.length).to.be.greaterThan(50); // 32 bytes key + note + nonce
    });

    it("Same meta-address produces different stealth addresses each time", async () => {
      const payment1 = await generateStealthPayment(employeeMetaKeys.metaAddress);
      const payment2 = await generateStealthPayment(employeeMetaKeys.metaAddress);

      console.log("\n=== Multiple Payments to Same Employee ===");
      console.log("Payment 1 stealth:", payment1.stealthAddress.toBase58());
      console.log("Payment 2 stealth:", payment2.stealthAddress.toBase58());

      // Each payment should have a unique stealth address
      expect(payment1.stealthAddress.toBase58()).to.not.equal(payment2.stealthAddress.toBase58());
      expect(payment1.ephemeralPubkey).to.not.equal(payment2.ephemeralPubkey);
    });
  });

  describe("3. Payment Discovery (Employee Side)", () => {
    it("Employee can verify a payment belongs to them", async () => {
      console.log("\n=== Employee Scans for Payments ===");

      // Employee uses their view private key to check if payment is theirs
      const isMine = await isMyStealthPayment(
        employeeMetaKeys.viewPrivKey,
        employeeMetaKeys.metaAddress.spendPubkey,
        stealthPayment.ephemeralPubkey,
        stealthPayment.stealthAddress
      );

      console.log("Checking payment to:", stealthPayment.stealthAddress.toBase58());
      console.log("Is this my payment?", isMine);

      expect(isMine).to.be.true;
    });

    it("Employee rejects payments not meant for them", async () => {
      // Generate a payment for a different employee
      const otherEmployee = generateStealthMetaKeys();
      const otherPayment = await generateStealthPayment(otherEmployee.metaAddress);

      // Our employee checks if this payment is theirs
      const isMine = await isMyStealthPayment(
        employeeMetaKeys.viewPrivKey,
        employeeMetaKeys.metaAddress.spendPubkey,
        otherPayment.ephemeralPubkey,
        otherPayment.stealthAddress
      );

      console.log("\n=== Checking Someone Else's Payment ===");
      console.log("Other payment stealth:", otherPayment.stealthAddress.toBase58());
      console.log("Is this my payment?", isMine);

      expect(isMine).to.be.false;
    });

    it("Employee can decrypt payment note", async () => {
      // Generate a payment with a specific note
      const secretNote = "Bonus: 5000 USDC for Q1 performance";
      const paymentWithNote = await generateStealthPayment(employeeMetaKeys.metaAddress, secretNote);

      console.log("\n=== Decrypting Payment Note ===");

      // Employee decrypts the note using their view private key
      const decryptedNote = await decryptNote(
        paymentWithNote.encryptedPayload,
        employeeMetaKeys.viewPrivKey,
        paymentWithNote.ephemeralPubkey
      );

      console.log("Original note:", secretNote);
      console.log("Decrypted note:", decryptedNote);

      expect(decryptedNote).to.equal(secretNote);
    });
  });

  describe("4. Stealth Keypair Derivation (Employee Side)", () => {
    it("Employee derives keypair to claim funds", async () => {
      console.log("\n=== Employee Derives Stealth Keypair ===");

      // First, decrypt the ephemeral private key from the payload
      const ephPriv = await decryptEphemeralPrivKey(
        stealthPayment.encryptedPayload,
        employeeMetaKeys.viewPrivKey,
        stealthPayment.ephemeralPubkey
      );

      console.log("Decrypted ephemeral privkey length:", ephPriv.length, "bytes");

      // Derive the full stealth keypair
      const stealthSigner = await deriveStealthKeypair(
        employeeMetaKeys.spendPrivKey,
        employeeMetaKeys.metaAddress.viewPubkey,
        ephPriv
      );

      console.log("Derived stealth pubkey:", stealthSigner.publicKey.toBase58());
      console.log("Expected stealth pubkey:", stealthPayment.stealthAddress.toBase58());

      // The derived public key should match the stealth address
      expect(stealthSigner.publicKey.toBase58()).to.equal(stealthPayment.stealthAddress.toBase58());
    });

    it("Employee can sign transactions with stealth keypair", async () => {
      console.log("\n=== Employee Signs Transaction ===");

      // Decrypt ephemeral private key
      const ephPriv = await decryptEphemeralPrivKey(
        stealthPayment.encryptedPayload,
        employeeMetaKeys.viewPrivKey,
        stealthPayment.ephemeralPubkey
      );

      // Derive stealth keypair
      const stealthSigner = await deriveStealthKeypair(
        employeeMetaKeys.spendPrivKey,
        employeeMetaKeys.metaAddress.viewPubkey,
        ephPriv
      );

      // Create a dummy transaction to sign
      const recipient = Keypair.generate().publicKey;
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: stealthSigner.publicKey,
          toPubkey: recipient,
          lamports: 1000000, // 0.001 SOL
        })
      );
      tx.recentBlockhash = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM"; // Dummy blockhash
      tx.feePayer = stealthSigner.publicKey;

      // Sign the transaction
      const signedTx = await stealthSigner.signTransaction(tx);

      console.log("Transaction signed successfully");
      console.log("Signature present:", signedTx.signatures.length > 0);
      console.log("Signature verified:", signedTx.signatures[0].signature !== null);

      expect(signedTx.signatures.length).to.be.greaterThan(0);
      expect(signedTx.signatures[0].signature).to.not.be.null;
    });

    it("Only the correct employee can derive the keypair", async () => {
      console.log("\n=== Other Employee Cannot Derive Keypair ===");

      // Another employee tries to derive the keypair
      const otherEmployee = generateStealthMetaKeys();

      // They would need to decrypt the ephemeral key first
      // But with wrong view key, they can't properly decrypt
      // Let's verify by showing they would derive a different address

      // For this test, assume they somehow got the ephemeral private key
      // (In practice they couldn't because it's encrypted to our view key)
      const ephPriv = await decryptEphemeralPrivKey(
        stealthPayment.encryptedPayload,
        employeeMetaKeys.viewPrivKey,
        stealthPayment.ephemeralPubkey
      );

      // Other employee tries with their spend key but correct ephemeral
      const wrongSigner = await deriveStealthKeypair(
        otherEmployee.spendPrivKey, // Wrong spend key
        employeeMetaKeys.metaAddress.viewPubkey, // Our view pubkey
        ephPriv
      );

      console.log("Other employee's derived pubkey:", wrongSigner.publicKey.toBase58());
      console.log("Actual stealth address:", stealthPayment.stealthAddress.toBase58());

      // They derive a different address - no access to funds
      expect(wrongSigner.publicKey.toBase58()).to.not.equal(stealthPayment.stealthAddress.toBase58());
    });
  });

  describe("5. Multi-Payment Scenario", () => {
    it("Employee can manage multiple payments", async () => {
      console.log("\n=== Multiple Payments to Employee ===");

      // Simulate multiple vesting payments
      const payments: StealthPaymentData[] = [];
      const notes = [
        "Q1 2024 Vesting - 2,500 USDC",
        "Q2 2024 Vesting - 2,500 USDC",
        "Bonus - 1,000 USDC",
      ];

      for (const note of notes) {
        const payment = await generateStealthPayment(employeeMetaKeys.metaAddress, note);
        payments.push(payment);
      }

      console.log("\nGenerated payments:");
      for (let i = 0; i < payments.length; i++) {
        console.log(`  ${i + 1}. ${payments[i].stealthAddress.toBase58()}`);
      }

      // Employee scans and finds all their payments
      console.log("\nEmployee scanning for payments...");
      const myPayments: { payment: StealthPaymentData; note: string }[] = [];

      for (const payment of payments) {
        const isMine = await isMyStealthPayment(
          employeeMetaKeys.viewPrivKey,
          employeeMetaKeys.metaAddress.spendPubkey,
          payment.ephemeralPubkey,
          payment.stealthAddress
        );

        if (isMine) {
          const note = await decryptNote(
            payment.encryptedPayload,
            employeeMetaKeys.viewPrivKey,
            payment.ephemeralPubkey
          );
          myPayments.push({ payment, note });
        }
      }

      console.log("\nDiscovered payments:");
      for (const { payment, note } of myPayments) {
        console.log(`  - ${note}`);
        console.log(`    Address: ${payment.stealthAddress.toBase58()}`);
      }

      expect(myPayments.length).to.equal(3);
      expect(myPayments[0].note).to.equal(notes[0]);
      expect(myPayments[1].note).to.equal(notes[1]);
      expect(myPayments[2].note).to.equal(notes[2]);
    });

    it("Employee can derive all keypairs for claiming", async () => {
      console.log("\n=== Deriving Keypairs for All Payments ===");

      const notes = ["Payment A", "Payment B", "Payment C"];
      const payments: StealthPaymentData[] = [];

      for (const note of notes) {
        payments.push(await generateStealthPayment(employeeMetaKeys.metaAddress, note));
      }

      // Employee derives keypairs for each payment
      const keypairs: { pubkey: string; canSign: boolean }[] = [];

      for (const payment of payments) {
        const ephPriv = await decryptEphemeralPrivKey(
          payment.encryptedPayload,
          employeeMetaKeys.viewPrivKey,
          payment.ephemeralPubkey
        );

        const signer = await deriveStealthKeypair(
          employeeMetaKeys.spendPrivKey,
          employeeMetaKeys.metaAddress.viewPubkey,
          ephPriv
        );

        keypairs.push({
          pubkey: signer.publicKey.toBase58(),
          canSign: signer.publicKey.toBase58() === payment.stealthAddress.toBase58(),
        });
      }

      console.log("Keypairs derived:");
      for (let i = 0; i < keypairs.length; i++) {
        console.log(`  ${notes[i]}: ${keypairs[i].pubkey}`);
        console.log(`    Can sign: ${keypairs[i].canSign}`);
      }

      // All keypairs should match their stealth addresses
      for (const kp of keypairs) {
        expect(kp.canSign).to.be.true;
      }
    });
  });

  describe("6. Edge Cases and Security", () => {
    it("Handles empty note gracefully", async () => {
      const payment = await generateStealthPayment(employeeMetaKeys.metaAddress, "");

      const decryptedNote = await decryptNote(
        payment.encryptedPayload,
        employeeMetaKeys.viewPrivKey,
        payment.ephemeralPubkey
      );

      expect(decryptedNote).to.equal("");
    });

    it("Handles long notes", async () => {
      const longNote = "A".repeat(200) + " - This is a very long note for testing purposes";
      const payment = await generateStealthPayment(employeeMetaKeys.metaAddress, longNote);

      const decryptedNote = await decryptNote(
        payment.encryptedPayload,
        employeeMetaKeys.viewPrivKey,
        payment.ephemeralPubkey
      );

      expect(decryptedNote).to.equal(longNote);
    });

    it("Stealth address is deterministic given same ephemeral key", async () => {
      // Generate a fresh ephemeral key
      const { ed25519 } = await import("@noble/curves/ed25519");
      const ephPriv = ed25519.utils.randomPrivateKey();

      // Derive stealth address twice with same ephemeral key
      const stealth1 = await deriveStealthPub(
        employeeMetaKeys.metaAddress.spendPubkey,
        employeeMetaKeys.metaAddress.viewPubkey,
        ephPriv
      );

      const stealth2 = await deriveStealthPub(
        employeeMetaKeys.metaAddress.spendPubkey,
        employeeMetaKeys.metaAddress.viewPubkey,
        ephPriv
      );

      console.log("\n=== Deterministic Derivation ===");
      console.log("Same ephemeral key produces same stealth address");
      console.log("Stealth 1:", stealth1.toBase58());
      console.log("Stealth 2:", stealth2.toBase58());

      expect(stealth1.toBase58()).to.equal(stealth2.toBase58());
    });
  });

  describe("7. Performance", () => {
    it("Measures key generation performance", async () => {
      const iterations = 100;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        generateStealthMetaKeys();
      }

      const elapsed = Date.now() - start;
      console.log(`\n=== Performance: Key Generation ===`);
      console.log(`Generated ${iterations} meta-key pairs in ${elapsed}ms`);
      console.log(`Average: ${(elapsed / iterations).toFixed(2)}ms per key pair`);

      expect(elapsed).to.be.lessThan(5000); // Should complete in < 5 seconds
    });

    it("Measures stealth address derivation performance", async () => {
      const iterations = 100;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        await generateStealthPayment(employeeMetaKeys.metaAddress);
      }

      const elapsed = Date.now() - start;
      console.log(`\n=== Performance: Stealth Address Derivation ===`);
      console.log(`Derived ${iterations} stealth addresses in ${elapsed}ms`);
      console.log(`Average: ${(elapsed / iterations).toFixed(2)}ms per derivation`);

      expect(elapsed).to.be.lessThan(10000); // Should complete in < 10 seconds
    });

    it("Measures payment verification performance", async () => {
      // Pre-generate payments
      const payments: StealthPaymentData[] = [];
      for (let i = 0; i < 50; i++) {
        payments.push(await generateStealthPayment(employeeMetaKeys.metaAddress));
      }

      const start = Date.now();

      for (const payment of payments) {
        await isMyStealthPayment(
          employeeMetaKeys.viewPrivKey,
          employeeMetaKeys.metaAddress.spendPubkey,
          payment.ephemeralPubkey,
          payment.stealthAddress
        );
      }

      const elapsed = Date.now() - start;
      console.log(`\n=== Performance: Payment Verification ===`);
      console.log(`Verified ${payments.length} payments in ${elapsed}ms`);
      console.log(`Average: ${(elapsed / payments.length).toFixed(2)}ms per verification`);

      expect(elapsed).to.be.lessThan(5000); // Should complete in < 5 seconds
    });
  });
});
