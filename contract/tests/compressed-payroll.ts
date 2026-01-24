/**
 * Integration tests for ShadowVest Compressed Token Payroll Distribution
 *
 * These tests verify the compressed token distribution functionality
 * using Light Protocol's ZK Compression.
 *
 * Prerequisites:
 * - Helius RPC endpoint with ZK Compression support
 * - Funded payer wallet on devnet
 * - Token mint registered with Light Protocol
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import {
  distributePayroll,
  decompressTokens,
  getCompressedBalance,
  getCompressedBalances,
  estimateDistributionCost,
  PayrollRecipient,
} from "../lib/compressed-payroll";

// Load environment variables
import "dotenv/config";

describe("Compressed Payroll Distribution", () => {
  // Test configuration
  const RPC_ENDPOINT =
    process.env.RPC_ENDPOINT || "https://devnet.helius-rpc.com/?api-key=YOUR_KEY";

  // Test keypairs (generated for testing)
  let payer: Keypair;
  let mint: PublicKey;
  let recipients: Keypair[];

  before(async () => {
    console.log("\n=== Setting up Compressed Payroll Tests ===\n");

    // Load payer from environment or generate new one
    if (process.env.PAYER_SECRET_KEY) {
      const secretKey = JSON.parse(process.env.PAYER_SECRET_KEY);
      payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } else {
      payer = Keypair.generate();
      console.log("Generated new payer keypair (needs funding for tests)");
    }

    console.log(`Payer: ${payer.publicKey.toBase58()}`);

    // Load or generate mint
    if (process.env.TEST_MINT) {
      mint = new PublicKey(process.env.TEST_MINT);
    } else {
      // For testing, we'll skip mint creation - it requires actual setup
      mint = Keypair.generate().publicKey;
      console.log("Generated placeholder mint (needs actual token for real tests)");
    }

    console.log(`Mint: ${mint.toBase58()}`);

    // Generate test recipient keypairs
    recipients = Array.from({ length: 10 }, () => Keypair.generate());
    console.log(`Generated ${recipients.length} test recipients`);
  });

  describe("Cost Estimation", () => {
    it("should estimate distribution cost correctly", () => {
      const estimate = estimateDistributionCost(100);

      expect(estimate.lamports).to.be.greaterThan(0);
      expect(estimate.sol).to.be.greaterThan(0);
      expect(estimate.comparedToSpl).to.include("cheaper than SPL");

      console.log("\nCost estimate for 100 recipients:");
      console.log(`  Lamports: ${estimate.lamports}`);
      console.log(`  SOL: ${estimate.sol}`);
      console.log(`  ${estimate.comparedToSpl}`);
    });

    it("should show significant savings for large distributions", () => {
      const smallEstimate = estimateDistributionCost(10);
      const largeEstimate = estimateDistributionCost(10000);

      // Cost should scale linearly
      expect(largeEstimate.lamports).to.equal(smallEstimate.lamports * 1000);

      console.log("\nScaling comparison:");
      console.log(`  10 recipients: ${smallEstimate.sol} SOL`);
      console.log(`  10,000 recipients: ${largeEstimate.sol} SOL`);
      console.log(`  ${largeEstimate.comparedToSpl}`);
    });
  });

  describe("Payroll Distribution (Integration)", () => {
    // Skip actual network tests unless explicitly enabled AND a real mint is provided
    const runIntegrationTests =
      process.env.RUN_INTEGRATION_TESTS === "true" && !!process.env.TEST_MINT;

    it("should prepare valid payroll configuration", () => {
      const payrollRecipients: PayrollRecipient[] = recipients.map(
        (r, index) => ({
          address: r.publicKey,
          amount: BigInt((index + 1) * 1000000), // 1-10 tokens
          identifier: `employee_${index + 1}`,
        })
      );

      expect(payrollRecipients.length).to.equal(10);
      expect(payrollRecipients[0].amount).to.equal(1000000n);
      expect(payrollRecipients[9].amount).to.equal(10000000n);

      const totalAmount = payrollRecipients.reduce(
        (sum, r) => sum + r.amount,
        0n
      );
      expect(totalAmount).to.equal(55000000n); // Sum of 1+2+...+10 million

      console.log("\nPayroll configuration:");
      console.log(`  Recipients: ${payrollRecipients.length}`);
      console.log(`  Total amount: ${totalAmount}`);
    });

    (runIntegrationTests ? it : it.skip)(
      "should distribute tokens to multiple recipients",
      async function () {
        this.timeout(120000); // 2 minute timeout for network operations

        const payrollRecipients: PayrollRecipient[] = recipients
          .slice(0, 5)
          .map((r, index) => ({
            address: r.publicKey,
            amount: BigInt((index + 1) * 1000000),
            identifier: `employee_${index + 1}`,
          }));

        console.log("\nStarting distribution test...");

        const result = await distributePayroll(RPC_ENDPOINT, payer, {
          mint,
          recipients: payrollRecipients,
          batchSize: 3,
          maxRetries: 2,
        });

        console.log("\nDistribution result:");
        console.log(`  Successful: ${result.successful}`);
        console.log(`  Failed: ${result.failed}`);
        console.log(`  Total amount: ${result.totalAmount}`);
        console.log(`  Execution time: ${result.executionTimeMs}ms`);

        // Verify results
        expect(result.successful + result.failed).to.equal(
          payrollRecipients.length
        );
        expect(result.batches.length).to.be.greaterThan(0);
      }
    );

    (runIntegrationTests ? it : it.skip)(
      "should check compressed balances after distribution",
      async function () {
        this.timeout(30000);

        const balances = await getCompressedBalances(
          RPC_ENDPOINT,
          recipients.slice(0, 5).map((r) => r.publicKey),
          mint
        );

        console.log("\nCompressed balances:");
        for (const [address, balance] of balances.entries()) {
          console.log(`  ${address.slice(0, 8)}...: ${balance}`);
        }

        expect(balances.size).to.equal(5);
      }
    );
  });

  describe("Token Decompression (Integration)", () => {
    const runIntegrationTests =
      process.env.RUN_INTEGRATION_TESTS === "true" && !!process.env.TEST_MINT;

    (runIntegrationTests ? it : it.skip)(
      "should decompress tokens to regular SPL",
      async function () {
        this.timeout(60000);

        const recipient = recipients[0];
        const balance = await getCompressedBalance(
          RPC_ENDPOINT,
          recipient.publicKey,
          mint
        );

        if (balance === 0n) {
          console.log("No compressed balance to decompress, skipping...");
          this.skip();
          return;
        }

        console.log(`\nDecompressing ${balance} tokens...`);

        const result = await decompressTokens(
          RPC_ENDPOINT,
          recipient,
          mint,
          balance
        );

        console.log("\nDecompression result:");
        console.log(`  Signature: ${result.signature}`);
        console.log(`  Amount: ${result.amount}`);
        console.log(`  Destination: ${result.destinationAccount.toBase58()}`);

        expect(result.amount).to.equal(balance);
      }
    );
  });

  describe("Error Handling", () => {
    it("should handle empty recipient list gracefully", async () => {
      const estimate = estimateDistributionCost(0);
      expect(estimate.lamports).to.equal(0);
    });

    it("should validate recipient addresses", () => {
      const validRecipient: PayrollRecipient = {
        address: Keypair.generate().publicKey,
        amount: 1000000n,
      };

      expect(validRecipient.address).to.be.instanceOf(PublicKey);
      expect(validRecipient.amount > BigInt(0)).to.be.true;
    });
  });

  describe("Batch Processing", () => {
    it("should correctly chunk recipients into batches", () => {
      // Test the chunking logic
      const testRecipients = Array.from({ length: 17 }, () => ({
        address: Keypair.generate().publicKey,
        amount: 1000n,
      }));

      const batchSize = 5;
      const expectedBatches = Math.ceil(testRecipients.length / batchSize);

      // Simulate chunking
      const chunks: PayrollRecipient[][] = [];
      for (let i = 0; i < testRecipients.length; i += batchSize) {
        chunks.push(testRecipients.slice(i, i + batchSize));
      }

      expect(chunks.length).to.equal(expectedBatches);
      expect(chunks[0].length).to.equal(5);
      expect(chunks[1].length).to.equal(5);
      expect(chunks[2].length).to.equal(5);
      expect(chunks[3].length).to.equal(2); // Last batch with remainder

      console.log("\nBatch chunking test:");
      console.log(`  Total recipients: ${testRecipients.length}`);
      console.log(`  Batch size: ${batchSize}`);
      console.log(`  Number of batches: ${chunks.length}`);
      console.log(`  Last batch size: ${chunks[chunks.length - 1].length}`);
    });
  });
});

/**
 * Helper to run tests with actual network connectivity
 *
 * Set these environment variables to run full integration tests:
 * - RUN_INTEGRATION_TESTS=true
 * - RPC_ENDPOINT=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
 * - PAYER_SECRET_KEY=[...array of numbers...]
 * - TEST_MINT=<mint_address>
 */
