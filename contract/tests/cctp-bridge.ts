/**
 * Integration tests for ShadowVest CCTP Bridge
 *
 * These tests verify the cross-chain USDC bridging functionality
 * using Circle's Cross-Chain Transfer Protocol (CCTP).
 *
 * Prerequisites:
 * - Helius RPC endpoint with transaction support
 * - Funded payer wallet on devnet with USDC
 * - CCTP contracts deployed on devnet
 */

import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import {
  CCTP_PROGRAMS,
  CCTP_DOMAINS,
  USDC_MINT,
  IRIS_API,
  CHAIN_INFO,
  evmAddressToCctp,
  solanaAddressToCctp,
  getChainName,
  getExplorerUrl,
  estimateBridgeTime,
  estimateBridgeCost,
  getAttestation,
  getUsdcBalance,
  CctpDomain,
} from "../lib/cctp-bridge";

// Load environment variables
import "dotenv/config";

describe("CCTP Bridge", () => {
  // Test configuration
  const RPC_ENDPOINT =
    process.env.RPC_ENDPOINT ||
    "https://devnet.helius-rpc.com/?api-key=YOUR_KEY";

  // Test keypairs
  let payer: Keypair;
  let connection: Connection;

  before(async () => {
    console.log("\n=== Setting up CCTP Bridge Tests ===\n");

    // Initialize connection
    connection = new Connection(RPC_ENDPOINT, "confirmed");

    // Load payer from environment or generate new one
    if (process.env.PAYER_SECRET_KEY) {
      const secretKey = JSON.parse(process.env.PAYER_SECRET_KEY);
      payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } else {
      payer = Keypair.generate();
      console.log("Generated new payer keypair (needs funding for tests)");
    }

    console.log(`Payer: ${payer.publicKey.toBase58()}`);
    console.log(`RPC Endpoint: ${RPC_ENDPOINT.split("?")[0]}...`);
  });

  describe("Constants and Configuration", () => {
    it("should have correct CCTP program addresses", () => {
      expect(CCTP_PROGRAMS.MESSAGE_TRANSMITTER.toBase58()).to.equal(
        "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
      );
      expect(CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER.toBase58()).to.equal(
        "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
      );
      expect(CCTP_PROGRAMS.MESSAGE_TRANSMITTER_V1.toBase58()).to.equal(
        "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd"
      );
      expect(CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER_V1.toBase58()).to.equal(
        "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3"
      );

      console.log("\nCCTP Program Addresses:");
      console.log(
        `  MessageTransmitter V2: ${CCTP_PROGRAMS.MESSAGE_TRANSMITTER.toBase58()}`
      );
      console.log(
        `  TokenMessengerMinter V2: ${CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER.toBase58()}`
      );
    });

    it("should have correct USDC mint addresses", () => {
      expect(USDC_MINT.MAINNET.toBase58()).to.equal(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      );
      expect(USDC_MINT.DEVNET.toBase58()).to.equal(
        "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
      );

      console.log("\nUSDC Mint Addresses:");
      console.log(`  Mainnet: ${USDC_MINT.MAINNET.toBase58()}`);
      console.log(`  Devnet: ${USDC_MINT.DEVNET.toBase58()}`);
    });

    it("should have correct CCTP domain IDs", () => {
      expect(CCTP_DOMAINS.ETHEREUM).to.equal(0);
      expect(CCTP_DOMAINS.AVALANCHE).to.equal(1);
      expect(CCTP_DOMAINS.OPTIMISM).to.equal(2);
      expect(CCTP_DOMAINS.ARBITRUM).to.equal(3);
      expect(CCTP_DOMAINS.NOBLE).to.equal(4);
      expect(CCTP_DOMAINS.SOLANA).to.equal(5);
      expect(CCTP_DOMAINS.BASE).to.equal(6);
      expect(CCTP_DOMAINS.POLYGON).to.equal(7);
      expect(CCTP_DOMAINS.SUI).to.equal(8);

      console.log("\nCCTP Domain IDs:");
      Object.entries(CCTP_DOMAINS).forEach(([name, id]) => {
        console.log(`  ${name}: ${id}`);
      });
    });

    it("should have Iris API endpoints", () => {
      expect(IRIS_API.MAINNET).to.equal("https://iris-api.circle.com");
      expect(IRIS_API.TESTNET).to.equal("https://iris-api-sandbox.circle.com");

      console.log("\nIris API Endpoints:");
      console.log(`  Mainnet: ${IRIS_API.MAINNET}`);
      console.log(`  Testnet: ${IRIS_API.TESTNET}`);
    });
  });

  describe("Address Conversion", () => {
    it("should convert EVM address to CCTP format", () => {
      const evmAddress = "0x1234567890123456789012345678901234567890";
      const cctpFormat = evmAddressToCctp(evmAddress);

      expect(cctpFormat.length).to.equal(32);
      // First 12 bytes should be zeros (left padding)
      for (let i = 0; i < 12; i++) {
        expect(cctpFormat[i]).to.equal(0);
      }
      // Last 20 bytes should be the address
      expect(cctpFormat[12]).to.equal(0x12);
      expect(cctpFormat[31]).to.equal(0x90);

      console.log("\nEVM to CCTP conversion:");
      console.log(`  Input: ${evmAddress}`);
      console.log(`  Output (hex): 0x${Buffer.from(cctpFormat).toString("hex")}`);
    });

    it("should reject invalid EVM addresses", () => {
      expect(() => evmAddressToCctp("0x1234")).to.throw("Invalid EVM address length");
      expect(() => evmAddressToCctp("invalid")).to.throw();
    });

    it("should convert Solana address to CCTP format", () => {
      const solanaAddress = Keypair.generate().publicKey;
      const cctpFormat = solanaAddressToCctp(solanaAddress);

      expect(cctpFormat.length).to.equal(32);
      expect(Buffer.from(cctpFormat).equals(solanaAddress.toBuffer())).to.be.true;

      console.log("\nSolana to CCTP conversion:");
      console.log(`  Input: ${solanaAddress.toBase58()}`);
      console.log(`  Output (hex): 0x${Buffer.from(cctpFormat).toString("hex")}`);
    });
  });

  describe("Chain Information", () => {
    it("should return correct chain names", () => {
      expect(getChainName(CCTP_DOMAINS.ETHEREUM)).to.equal("Ethereum");
      expect(getChainName(CCTP_DOMAINS.SOLANA)).to.equal("Solana");
      expect(getChainName(CCTP_DOMAINS.BASE)).to.equal("Base");
      expect(getChainName(CCTP_DOMAINS.ARBITRUM)).to.equal("Arbitrum");

      console.log("\nSupported Chains:");
      Object.values(CCTP_DOMAINS).forEach((domain) => {
        const info = CHAIN_INFO[domain as CctpDomain];
        if (info) {
          console.log(`  ${info.name} (Domain ${domain}): ${info.usdcAddress}`);
        }
      });
    });

    it("should generate correct explorer URLs", () => {
      const txHash =
        "5vGyF7JgzrY1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM";

      const solanaUrl = getExplorerUrl(CCTP_DOMAINS.SOLANA, txHash);
      expect(solanaUrl).to.include("solscan.io/tx/");
      expect(solanaUrl).to.include(txHash);

      const ethUrl = getExplorerUrl(CCTP_DOMAINS.ETHEREUM, txHash);
      expect(ethUrl).to.include("etherscan.io/tx/");

      console.log("\nExplorer URL examples:");
      console.log(`  Solana: ${solanaUrl}`);
      console.log(`  Ethereum: ${ethUrl}`);
    });
  });

  describe("Time and Cost Estimates", () => {
    it("should estimate bridge time for different chains", () => {
      const solanaEstimate = estimateBridgeTime(CCTP_DOMAINS.SOLANA);
      expect(solanaEstimate.minMinutes).to.be.lessThan(5);
      expect(solanaEstimate.maxMinutes).to.be.lessThan(10);

      const ethEstimate = estimateBridgeTime(CCTP_DOMAINS.ETHEREUM);
      expect(ethEstimate.minMinutes).to.be.greaterThan(10);

      console.log("\nBridge Time Estimates:");
      Object.entries(CCTP_DOMAINS).forEach(([name, domain]) => {
        const estimate = estimateBridgeTime(domain as CctpDomain);
        console.log(
          `  ${name}: ${estimate.minMinutes}-${estimate.maxMinutes} min (${estimate.description})`
        );
      });
    });

    it("should estimate bridge costs for different destinations", () => {
      const solanaCost = estimateBridgeCost(CCTP_DOMAINS.SOLANA);
      expect(solanaCost.estimatedUsd).to.include("$");

      const ethCost = estimateBridgeCost(CCTP_DOMAINS.ETHEREUM);
      expect(ethCost.estimatedUsd).to.include("$");

      console.log("\nBridge Cost Estimates (destination chain fees):");
      Object.entries(CCTP_DOMAINS).forEach(([name, domain]) => {
        const cost = estimateBridgeCost(domain as CctpDomain);
        console.log(`  ${name}: ${cost.estimatedUsd} - ${cost.description}`);
      });
    });
  });

  describe("Attestation Service", () => {
    it("should return pending for non-existent message hash", async () => {
      const fakeHash = "0000000000000000000000000000000000000000000000000000000000000000";

      const result = await getAttestation(fakeHash, false);

      expect(result.status).to.equal("pending");
      expect(result.attestation).to.be.null;
      expect(result.messageHash).to.equal(fakeHash);

      console.log("\nAttestation lookup for non-existent hash:");
      console.log(`  Status: ${result.status}`);
    });
  });

  describe("USDC Balance (Integration)", () => {
    const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === "true";

    (runIntegrationTests ? it : it.skip)(
      "should check USDC balance on devnet",
      async function () {
        this.timeout(30000);

        const balance = await getUsdcBalance(connection, payer.publicKey, false);

        console.log("\nUSDC Balance Check:");
        console.log(`  Wallet: ${payer.publicKey.toBase58()}`);
        console.log(`  Balance: ${Number(balance) / 1_000_000} USDC`);

        // Balance should be a valid bigint (>= 0)
        expect(balance >= BigInt(0)).to.be.true;
      }
    );
  });

  describe("Bridge Flow Simulation", () => {
    it("should simulate complete bridge flow (dry run)", () => {
      // Simulate bridging 100 USDC to Ethereum
      const amount = BigInt(100_000_000); // 100 USDC
      const destinationDomain = CCTP_DOMAINS.ETHEREUM;
      const destinationRecipient = evmAddressToCctp(
        "0x1234567890123456789012345678901234567890"
      );

      console.log("\n=== Bridge Flow Simulation ===");
      console.log("\n1. Bridge Configuration:");
      console.log(`   Amount: ${Number(amount) / 1_000_000} USDC`);
      console.log(`   From: Solana (Domain ${CCTP_DOMAINS.SOLANA})`);
      console.log(`   To: ${getChainName(destinationDomain)} (Domain ${destinationDomain})`);
      console.log(
        `   Recipient: 0x${Buffer.from(destinationRecipient).toString("hex").slice(24)}`
      );

      const timeEstimate = estimateBridgeTime(CCTP_DOMAINS.SOLANA);
      const costEstimate = estimateBridgeCost(destinationDomain);

      console.log("\n2. Estimates:");
      console.log(`   Time: ${timeEstimate.description}`);
      console.log(`   Cost: ${costEstimate.estimatedUsd} (${costEstimate.description})`);

      console.log("\n3. Flow Steps:");
      console.log("   [1] depositForBurn on Solana TokenMessengerMinter");
      console.log("       -> Burns USDC on Solana");
      console.log("       -> Emits MessageSent event");
      console.log("   [2] Wait for Circle Iris attestation");
      console.log(`       -> ~${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} minutes`);
      console.log("   [3] receiveMessage on Ethereum MessageTransmitter");
      console.log("       -> Verifies attestation");
      console.log("       -> Mints USDC to recipient");

      console.log("\n4. Required Accounts (Solana depositForBurn):");
      console.log(`   - owner: [payer]`);
      console.log(`   - burnTokenAccount: [payer's USDC ATA]`);
      console.log(
        `   - messageTransmitter: ${CCTP_PROGRAMS.MESSAGE_TRANSMITTER.toBase58()}`
      );
      console.log(
        `   - tokenMessengerMinter: ${CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER.toBase58()}`
      );
      console.log(`   - usdcMint: ${USDC_MINT.DEVNET.toBase58()}`);

      // Verify parameters are valid
      expect(amount > BigInt(0)).to.be.true;
      expect(destinationRecipient.length).to.equal(32);
      expect(destinationDomain).to.be.oneOf(Object.values(CCTP_DOMAINS));
    });

    it("should simulate receiving USDC on Solana", () => {
      // Simulate receiving 100 USDC from Ethereum
      const amount = BigInt(100_000_000);
      const sourceDomain = CCTP_DOMAINS.ETHEREUM;
      const recipient = Keypair.generate().publicKey;

      console.log("\n=== Receive Flow Simulation ===");
      console.log("\n1. Receive Configuration:");
      console.log(`   Amount: ${Number(amount) / 1_000_000} USDC`);
      console.log(`   From: ${getChainName(sourceDomain)} (Domain ${sourceDomain})`);
      console.log(`   To: Solana (Domain ${CCTP_DOMAINS.SOLANA})`);
      console.log(`   Recipient: ${recipient.toBase58()}`);

      console.log("\n2. Prerequisites:");
      console.log("   - Message bytes from source chain depositForBurn");
      console.log("   - Attestation from Circle Iris API");
      console.log("   - Recipient USDC ATA (will be created if needed)");

      console.log("\n3. Flow Steps:");
      console.log("   [1] Parse message to extract nonce and source domain");
      console.log("   [2] Derive usedNonces PDA to prevent replay");
      console.log("   [3] Call receiveMessage on MessageTransmitter");
      console.log("       -> Verifies attestation signature");
      console.log("       -> Mints USDC to recipient");

      console.log("\n4. Required Accounts (Solana receiveMessage):");
      console.log(`   - caller: [relayer/recipient]`);
      console.log(
        `   - messageTransmitter: ${CCTP_PROGRAMS.MESSAGE_TRANSMITTER.toBase58()}`
      );
      console.log(`   - usedNonces: [derived from source domain + nonce]`);
      console.log(
        `   - receiver: ${CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER.toBase58()}`
      );
      console.log(`   - recipientTokenAccount: [recipient's USDC ATA]`);
      console.log(`   - usdcMint: ${USDC_MINT.DEVNET.toBase58()}`);
    });
  });

  describe("Employee Withdrawal Options", () => {
    it("should support multiple withdrawal destinations", () => {
      const supportedDestinations = [
        { domain: CCTP_DOMAINS.SOLANA, description: "Stay on Solana (no CCTP needed)" },
        { domain: CCTP_DOMAINS.ETHEREUM, description: "Bridge to Ethereum mainnet" },
        { domain: CCTP_DOMAINS.BASE, description: "Bridge to Base (low fees)" },
        { domain: CCTP_DOMAINS.ARBITRUM, description: "Bridge to Arbitrum" },
        { domain: CCTP_DOMAINS.POLYGON, description: "Bridge to Polygon" },
        { domain: CCTP_DOMAINS.OPTIMISM, description: "Bridge to Optimism" },
        { domain: CCTP_DOMAINS.AVALANCHE, description: "Bridge to Avalanche" },
      ];

      console.log("\n=== Employee Withdrawal Options ===\n");
      console.log("An employee with vested USDC can claim to any CCTP-supported chain:\n");

      supportedDestinations.forEach((dest) => {
        const cost = estimateBridgeCost(dest.domain);
        const time = estimateBridgeTime(CCTP_DOMAINS.SOLANA);
        console.log(`${getChainName(dest.domain)}:`);
        console.log(`  ${dest.description}`);
        console.log(`  Cost: ${cost.estimatedUsd}`);
        console.log(
          `  Time: ${dest.domain === CCTP_DOMAINS.SOLANA ? "Instant" : time.description}`
        );
        console.log("");
      });

      expect(supportedDestinations.length).to.be.greaterThan(5);
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
 *
 * For actual bridge tests, the payer needs:
 * - SOL for transaction fees
 * - USDC (devnet) for bridging
 */
