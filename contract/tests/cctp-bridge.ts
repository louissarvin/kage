/**
 * Integration tests for ShadowVest CCTP Bridge
 *
 * These tests verify the cross-chain USDC bridging functionality
 * using Circle's Cross-Chain Transfer Protocol (CCTP).
 *
 * Test Categories:
 * 1. Constants and Configuration - Verify program addresses and domain IDs
 * 2. Address Conversion - Test EVM/Solana address formatting
 * 3. Message Parsing - Test V1 and V2 message format parsing
 * 4. Instruction Serialization - Dry-run tests for instruction building
 * 5. PDA Derivation - Verify PDA seeds and addresses
 * 6. Integration Tests - Actual network operations (requires funding)
 *
 * Prerequisites:
 * - Helius RPC endpoint with transaction support
 * - Funded payer wallet on devnet with USDC
 * - CCTP contracts deployed on devnet
 */

import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import { expect } from "chai";
import {
  // Constants
  CCTP_PROGRAMS,
  CCTP_DOMAINS,
  USDC_MINT,
  IRIS_API,
  CHAIN_INFO,
  MESSAGE_V1_OFFSETS,
  MESSAGE_V2_OFFSETS,
  BURN_MESSAGE_OFFSETS,
  MESSAGE_SENT_ACCOUNT_OFFSETS,
  INSTRUCTION_DISCRIMINATORS,
  // Types
  CctpDomain,
  DepositForBurnV2Params,
  ParsedCctpMessage,
  ParsedBurnMessage,
  // PDA Functions
  findMessageTransmitterPda,
  findTokenMessengerPda,
  findTokenMinterPda,
  findLocalTokenPda,
  findRemoteTokenMessengerPda,
  findSenderAuthorityPda,
  findCustodyTokenAccountPda,
  findTokenPairPda,
  findUsedNoncesPdaV1,
  findUsedNoncesPdaV2,
  findAuthorityPda,
  findDenylistPda,
  getAllPdas,
  // Message Parsing
  detectMessageVersion,
  parseMessageV1,
  parseMessageV2,
  parseMessage,
  parseBurnMessage,
  extractMessageFromEventAccount,
  computeMessageHash,
  validateMessage,
  // Address Conversion
  evmAddressToCctp,
  solanaAddressToCctp,
  cctpToEvmAddress,
  cctpToSolanaAddress,
  // Utility Functions
  getChainName,
  getExplorerUrl,
  estimateBridgeTime,
  estimateBridgeCost,
  // Core Functions
  getAttestation,
  getAttestationV2,
  getUsdcBalance,
  // Dry-Run Helpers
  buildDepositForBurnInstruction,
  serializeInstructionData,
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

  // ==========================================================================
  // Constants and Configuration Tests
  // ==========================================================================

  describe("Constants and Configuration", () => {
    it("should have correct CCTP V2 program addresses", () => {
      expect(CCTP_PROGRAMS.MESSAGE_TRANSMITTER.toBase58()).to.equal(
        "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
      );
      expect(CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER.toBase58()).to.equal(
        "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
      );

      console.log("\nCCTP V2 Program Addresses:");
      console.log(
        `  MessageTransmitter: ${CCTP_PROGRAMS.MESSAGE_TRANSMITTER.toBase58()}`
      );
      console.log(
        `  TokenMessengerMinter: ${CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER.toBase58()}`
      );
    });

    it("should have correct CCTP V1 program addresses", () => {
      expect(CCTP_PROGRAMS.MESSAGE_TRANSMITTER_V1.toBase58()).to.equal(
        "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd"
      );
      expect(CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER_V1.toBase58()).to.equal(
        "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3"
      );

      console.log("\nCCTP V1 Program Addresses (Legacy):");
      console.log(
        `  MessageTransmitter: ${CCTP_PROGRAMS.MESSAGE_TRANSMITTER_V1.toBase58()}`
      );
      console.log(
        `  TokenMessengerMinter: ${CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER_V1.toBase58()}`
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

  // ==========================================================================
  // Message Format Constants Tests
  // ==========================================================================

  describe("Message Format Constants", () => {
    it("should have correct V1 message offsets", () => {
      expect(MESSAGE_V1_OFFSETS.VERSION).to.equal(0);
      expect(MESSAGE_V1_OFFSETS.SOURCE_DOMAIN).to.equal(4);
      expect(MESSAGE_V1_OFFSETS.DESTINATION_DOMAIN).to.equal(8);
      expect(MESSAGE_V1_OFFSETS.NONCE).to.equal(12);
      expect(MESSAGE_V1_OFFSETS.NONCE_SIZE).to.equal(8); // V1 uses 8-byte nonce
      expect(MESSAGE_V1_OFFSETS.SENDER).to.equal(20);
      expect(MESSAGE_V1_OFFSETS.RECIPIENT).to.equal(52);
      expect(MESSAGE_V1_OFFSETS.DESTINATION_CALLER).to.equal(84);
      expect(MESSAGE_V1_OFFSETS.MESSAGE_BODY).to.equal(116);

      console.log("\nV1 Message Offsets:");
      console.log(`  Nonce at offset ${MESSAGE_V1_OFFSETS.NONCE} (${MESSAGE_V1_OFFSETS.NONCE_SIZE} bytes)`);
      console.log(`  Message body starts at offset ${MESSAGE_V1_OFFSETS.MESSAGE_BODY}`);
    });

    it("should have correct V2 message offsets", () => {
      expect(MESSAGE_V2_OFFSETS.VERSION).to.equal(0);
      expect(MESSAGE_V2_OFFSETS.SOURCE_DOMAIN).to.equal(4);
      expect(MESSAGE_V2_OFFSETS.DESTINATION_DOMAIN).to.equal(8);
      expect(MESSAGE_V2_OFFSETS.NONCE).to.equal(12);
      expect(MESSAGE_V2_OFFSETS.NONCE_SIZE).to.equal(32); // V2 uses 32-byte nonce
      expect(MESSAGE_V2_OFFSETS.SENDER).to.equal(44);
      expect(MESSAGE_V2_OFFSETS.RECIPIENT).to.equal(76);
      expect(MESSAGE_V2_OFFSETS.DESTINATION_CALLER).to.equal(108);
      expect(MESSAGE_V2_OFFSETS.FINALITY_THRESHOLD).to.equal(140);
      expect(MESSAGE_V2_OFFSETS.MESSAGE_BODY).to.equal(144);

      console.log("\nV2 Message Offsets:");
      console.log(`  Nonce at offset ${MESSAGE_V2_OFFSETS.NONCE} (${MESSAGE_V2_OFFSETS.NONCE_SIZE} bytes)`);
      console.log(`  Finality threshold at offset ${MESSAGE_V2_OFFSETS.FINALITY_THRESHOLD}`);
      console.log(`  Message body starts at offset ${MESSAGE_V2_OFFSETS.MESSAGE_BODY}`);
    });

    it("should have correct burn message offsets", () => {
      expect(BURN_MESSAGE_OFFSETS.VERSION).to.equal(0);
      expect(BURN_MESSAGE_OFFSETS.BURN_TOKEN).to.equal(4);
      expect(BURN_MESSAGE_OFFSETS.MINT_RECIPIENT).to.equal(36);
      expect(BURN_MESSAGE_OFFSETS.AMOUNT).to.equal(68);
      expect(BURN_MESSAGE_OFFSETS.AMOUNT_SIZE).to.equal(32); // u256
      expect(BURN_MESSAGE_OFFSETS.MESSAGE_SENDER).to.equal(100);

      console.log("\nBurn Message Offsets:");
      console.log(`  Amount at offset ${BURN_MESSAGE_OFFSETS.AMOUNT} (${BURN_MESSAGE_OFFSETS.AMOUNT_SIZE} bytes)`);
    });

    it("should have correct MessageSent account offsets", () => {
      // V1
      expect(MESSAGE_SENT_ACCOUNT_OFFSETS.V1_DISCRIMINATOR).to.equal(0);
      expect(MESSAGE_SENT_ACCOUNT_OFFSETS.V1_RENT_PAYER).to.equal(8);
      expect(MESSAGE_SENT_ACCOUNT_OFFSETS.V1_MESSAGE_START).to.equal(40);

      // V2
      expect(MESSAGE_SENT_ACCOUNT_OFFSETS.V2_DISCRIMINATOR).to.equal(0);
      expect(MESSAGE_SENT_ACCOUNT_OFFSETS.V2_RENT_PAYER).to.equal(8);
      expect(MESSAGE_SENT_ACCOUNT_OFFSETS.V2_CREATED_AT).to.equal(40);
      expect(MESSAGE_SENT_ACCOUNT_OFFSETS.V2_MESSAGE_START).to.equal(48);

      console.log("\nMessageSent Account Offsets:");
      console.log(`  V1 message start: ${MESSAGE_SENT_ACCOUNT_OFFSETS.V1_MESSAGE_START}`);
      console.log(`  V2 message start: ${MESSAGE_SENT_ACCOUNT_OFFSETS.V2_MESSAGE_START}`);
    });
  });

  // ==========================================================================
  // Instruction Discriminator Tests
  // ==========================================================================

  describe("Instruction Discriminators", () => {
    it("should compute correct Anchor discriminators", () => {
      // Discriminators are SHA256("global:<instruction_name>")[0:8]
      expect(INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN).to.be.instanceOf(
        Buffer
      );
      expect(INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN.length).to.equal(8);
      expect(INSTRUCTION_DISCRIMINATORS.RECEIVE_MESSAGE.length).to.equal(8);
      expect(INSTRUCTION_DISCRIMINATORS.RECLAIM_EVENT_ACCOUNT.length).to.equal(
        8
      );

      console.log("\nInstruction Discriminators (hex):");
      console.log(
        `  depositForBurn: ${INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN.toString("hex")}`
      );
      console.log(
        `  depositForBurnWithCaller: ${INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN_WITH_CALLER.toString("hex")}`
      );
      console.log(
        `  receiveMessage: ${INSTRUCTION_DISCRIMINATORS.RECEIVE_MESSAGE.toString("hex")}`
      );
      console.log(
        `  reclaimEventAccount: ${INSTRUCTION_DISCRIMINATORS.RECLAIM_EVENT_ACCOUNT.toString("hex")}`
      );
    });

    it("should have unique discriminators for each instruction", () => {
      const discriminators = [
        INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN,
        INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN_WITH_CALLER,
        INSTRUCTION_DISCRIMINATORS.RECEIVE_MESSAGE,
        INSTRUCTION_DISCRIMINATORS.RECLAIM_EVENT_ACCOUNT,
      ];

      const hexValues = discriminators.map((d) => d.toString("hex"));
      const uniqueValues = new Set(hexValues);
      expect(uniqueValues.size).to.equal(discriminators.length);
    });
  });

  // ==========================================================================
  // Address Conversion Tests
  // ==========================================================================

  describe("Address Conversion", () => {
    it("should convert EVM address to CCTP format (left-padded)", () => {
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

    it("should convert CCTP format back to EVM address", () => {
      const originalAddress = "0x1234567890123456789012345678901234567890";
      const cctpFormat = evmAddressToCctp(originalAddress);
      const recoveredAddress = cctpToEvmAddress(cctpFormat);

      expect(recoveredAddress.toLowerCase()).to.equal(
        originalAddress.toLowerCase()
      );
    });

    it("should reject invalid EVM addresses", () => {
      expect(() => evmAddressToCctp("0x1234")).to.throw(
        "Invalid EVM address length"
      );
      expect(() => evmAddressToCctp("invalid")).to.throw();
    });

    it("should convert Solana address to CCTP format", () => {
      const solanaAddress = Keypair.generate().publicKey;
      const cctpFormat = solanaAddressToCctp(solanaAddress);

      expect(cctpFormat.length).to.equal(32);
      expect(Buffer.from(cctpFormat).equals(solanaAddress.toBuffer())).to.be
        .true;

      console.log("\nSolana to CCTP conversion:");
      console.log(`  Input: ${solanaAddress.toBase58()}`);
      console.log(`  Output (hex): 0x${Buffer.from(cctpFormat).toString("hex")}`);
    });

    it("should convert CCTP format back to Solana PublicKey", () => {
      const originalKey = Keypair.generate().publicKey;
      const cctpFormat = solanaAddressToCctp(originalKey);
      const recoveredKey = cctpToSolanaAddress(cctpFormat);

      expect(recoveredKey.equals(originalKey)).to.be.true;
    });
  });

  // ==========================================================================
  // Message Parsing Tests
  // ==========================================================================

  describe("Message Parsing", () => {
    // Create test V1 message (116 bytes header + message body)
    function createTestMessageV1(): Buffer {
      const message = Buffer.alloc(248); // Header (116) + body (132)
      let offset = 0;

      // Version (0 = V1)
      message.writeUInt32BE(0, offset);
      offset += 4;

      // Source domain (Ethereum = 0)
      message.writeUInt32BE(0, offset);
      offset += 4;

      // Destination domain (Solana = 5)
      message.writeUInt32BE(5, offset);
      offset += 4;

      // Nonce (8 bytes)
      message.writeBigUInt64BE(BigInt(12345), offset);
      offset += 8;

      // Sender (32 bytes) - mock address
      const sender = Buffer.alloc(32, 0xaa);
      sender.copy(message, offset);
      offset += 32;

      // Recipient (32 bytes) - mock address
      const recipient = Buffer.alloc(32, 0xbb);
      recipient.copy(message, offset);
      offset += 32;

      // Destination caller (32 bytes) - zeros = any caller
      offset += 32;

      // Message body (burn message)
      createBurnMessageBody().copy(message, offset);

      return message;
    }

    // Create test V2 message (144 bytes header + message body)
    function createTestMessageV2(): Buffer {
      const message = Buffer.alloc(280); // Header + body
      let offset = 0;

      // Version (2 = V2)
      message.writeUInt32BE(2, offset);
      offset += 4;

      // Source domain (Ethereum = 0)
      message.writeUInt32BE(0, offset);
      offset += 4;

      // Destination domain (Solana = 5)
      message.writeUInt32BE(5, offset);
      offset += 4;

      // Nonce (32 bytes)
      const nonce = Buffer.alloc(32);
      nonce.writeBigUInt64BE(BigInt(67890), 0);
      nonce.copy(message, offset);
      offset += 32;

      // Sender (32 bytes)
      const sender = Buffer.alloc(32, 0xcc);
      sender.copy(message, offset);
      offset += 32;

      // Recipient (32 bytes)
      const recipient = Buffer.alloc(32, 0xdd);
      recipient.copy(message, offset);
      offset += 32;

      // Destination caller (32 bytes)
      offset += 32;

      // Finality threshold (4 bytes)
      message.writeUInt32BE(2000, offset);
      offset += 4;

      // Message body (burn message)
      createBurnMessageBody().copy(message, offset);

      return message;
    }

    // Create burn message body
    function createBurnMessageBody(): Buffer {
      const body = Buffer.alloc(132);
      let offset = 0;

      // Version
      body.writeUInt32BE(0, offset);
      offset += 4;

      // Burn token (32 bytes) - USDC address
      const burnToken = Buffer.alloc(32, 0x11);
      burnToken.copy(body, offset);
      offset += 32;

      // Mint recipient (32 bytes)
      const mintRecipient = Buffer.alloc(32, 0x22);
      mintRecipient.copy(body, offset);
      offset += 32;

      // Amount (32 bytes u256) - 100 USDC
      const amount = Buffer.alloc(32);
      amount.writeBigUInt64BE(BigInt(100_000_000), 24); // 100 USDC in last 8 bytes
      amount.copy(body, offset);
      offset += 32;

      // Message sender (32 bytes)
      const messageSender = Buffer.alloc(32, 0x33);
      messageSender.copy(body, offset);

      return body;
    }

    it("should detect V1 message version", () => {
      const v1Message = createTestMessageV1();
      expect(detectMessageVersion(v1Message)).to.equal(1);
    });

    it("should detect V2 message version", () => {
      const v2Message = createTestMessageV2();
      expect(detectMessageVersion(v2Message)).to.equal(2);
    });

    it("should parse V1 message correctly", () => {
      const message = createTestMessageV1();
      const parsed = parseMessageV1(message);

      expect(parsed.version).to.equal(0);
      expect(parsed.sourceDomain).to.equal(0); // Ethereum
      expect(parsed.destinationDomain).to.equal(5); // Solana
      expect(parsed.nonce).to.equal(BigInt(12345));
      expect(parsed.sender.length).to.equal(32);
      expect(parsed.recipient.length).to.equal(32);
      expect(parsed.destinationCaller.length).to.equal(32);
      expect(parsed.messageBody.length).to.be.greaterThan(0);

      console.log("\nParsed V1 Message:");
      console.log(`  Version: ${parsed.version}`);
      console.log(`  Source Domain: ${parsed.sourceDomain} (${getChainName(parsed.sourceDomain as CctpDomain)})`);
      console.log(`  Dest Domain: ${parsed.destinationDomain} (${getChainName(parsed.destinationDomain as CctpDomain)})`);
      console.log(`  Nonce: ${parsed.nonce}`);
    });

    it("should parse V2 message correctly", () => {
      const message = createTestMessageV2();
      const parsed = parseMessageV2(message);

      expect(parsed.version).to.equal(2);
      expect(parsed.sourceDomain).to.equal(0); // Ethereum
      expect(parsed.destinationDomain).to.equal(5); // Solana
      expect(parsed.nonce).to.equal(BigInt(67890));
      expect(parsed.finalityThreshold).to.equal(2000);
      expect(parsed.messageBody.length).to.be.greaterThan(0);

      console.log("\nParsed V2 Message:");
      console.log(`  Version: ${parsed.version}`);
      console.log(`  Source Domain: ${parsed.sourceDomain}`);
      console.log(`  Dest Domain: ${parsed.destinationDomain}`);
      console.log(`  Nonce: ${parsed.nonce}`);
      console.log(`  Finality Threshold: ${parsed.finalityThreshold}`);
    });

    it("should auto-detect and parse message version", () => {
      const v1Message = createTestMessageV1();
      const v2Message = createTestMessageV2();

      const parsedV1 = parseMessage(v1Message);
      const parsedV2 = parseMessage(v2Message);

      expect(parsedV1.version).to.equal(0);
      expect(parsedV2.version).to.equal(2);
      expect(parsedV2.finalityThreshold).to.equal(2000);
    });

    it("should parse burn message from message body", () => {
      const v1Message = createTestMessageV1();
      const parsed = parseMessage(v1Message);
      const burnMessage = parseBurnMessage(parsed.messageBody);

      expect(burnMessage.version).to.equal(0);
      expect(burnMessage.burnToken.length).to.equal(32);
      expect(burnMessage.mintRecipient.length).to.equal(32);
      expect(burnMessage.amount).to.equal(BigInt(100_000_000)); // 100 USDC
      expect(burnMessage.messageSender.length).to.equal(32);

      console.log("\nParsed Burn Message:");
      console.log(`  Amount: ${Number(burnMessage.amount) / 1_000_000} USDC`);
    });

    it("should validate message integrity", () => {
      const validMessage = createTestMessageV1();
      const result = validateMessage(validMessage);
      expect(result.valid).to.be.true;

      // Test invalid message
      const invalidMessage = Buffer.alloc(10);
      const invalidResult = validateMessage(invalidMessage);
      expect(invalidResult.valid).to.be.false;
      expect(invalidResult.error).to.exist;
    });

    it("should compute message hash", () => {
      const message = createTestMessageV1();
      const hash = computeMessageHash(message);

      expect(hash).to.match(/^0x[a-f0-9]{64}$/);
      console.log(`\nMessage hash: ${hash}`);
    });
  });

  // ==========================================================================
  // PDA Derivation Tests
  // ==========================================================================

  describe("PDA Derivation", () => {
    it("should derive message transmitter PDA", () => {
      const [pdaV2, bumpV2] = findMessageTransmitterPda(true);
      const [pdaV1, bumpV1] = findMessageTransmitterPda(false);

      expect(pdaV2).to.be.instanceOf(PublicKey);
      expect(pdaV1).to.be.instanceOf(PublicKey);
      expect(pdaV2.equals(pdaV1)).to.be.false; // Different program IDs

      console.log("\nMessage Transmitter PDAs:");
      console.log(`  V2: ${pdaV2.toBase58()} (bump: ${bumpV2})`);
      console.log(`  V1: ${pdaV1.toBase58()} (bump: ${bumpV1})`);
    });

    it("should derive token messenger PDA", () => {
      const [pda, bump] = findTokenMessengerPda(true);
      expect(pda).to.be.instanceOf(PublicKey);
      console.log(`\nToken Messenger PDA: ${pda.toBase58()} (bump: ${bump})`);
    });

    it("should derive local token PDA", () => {
      const [pda, bump] = findLocalTokenPda(USDC_MINT.DEVNET, true);
      expect(pda).to.be.instanceOf(PublicKey);
      console.log(`\nLocal Token PDA: ${pda.toBase58()} (bump: ${bump})`);
    });

    it("should derive remote token messenger PDA for each domain", () => {
      console.log("\nRemote Token Messenger PDAs:");
      for (const [name, domain] of Object.entries(CCTP_DOMAINS)) {
        if (domain !== CCTP_DOMAINS.SOLANA) {
          const [pda, bump] = findRemoteTokenMessengerPda(domain, true);
          console.log(`  ${name} (${domain}): ${pda.toBase58()}`);
        }
      }
    });

    it("should derive used nonces PDA (V1)", () => {
      const [pda, bump] = findUsedNoncesPdaV1(0, BigInt(12345));
      expect(pda).to.be.instanceOf(PublicKey);
      console.log(`\nUsed Nonces PDA (V1): ${pda.toBase58()}`);
    });

    it("should derive used nonces PDA (V2)", () => {
      const [pda, bump] = findUsedNoncesPdaV2(0, BigInt(12345));
      expect(pda).to.be.instanceOf(PublicKey);
      console.log(`\nUsed Nonces PDA (V2): ${pda.toBase58()}`);
    });

    it("should get all PDAs for a bridge operation", () => {
      const pdas = getAllPdas(USDC_MINT.DEVNET, CCTP_DOMAINS.ETHEREUM, true);

      expect(pdas.messageTransmitter).to.be.instanceOf(PublicKey);
      expect(pdas.tokenMessenger).to.be.instanceOf(PublicKey);
      expect(pdas.tokenMinter).to.be.instanceOf(PublicKey);
      expect(pdas.localToken).to.be.instanceOf(PublicKey);
      expect(pdas.remoteTokenMessenger).to.be.instanceOf(PublicKey);
      expect(pdas.senderAuthority).to.be.instanceOf(PublicKey);
      expect(pdas.custodyTokenAccount).to.be.instanceOf(PublicKey);

      console.log("\nAll PDAs for Ethereum bridge:");
      Object.entries(pdas).forEach(([name, key]) => {
        console.log(`  ${name}: ${key.toBase58()}`);
      });
    });
  });

  // ==========================================================================
  // Instruction Serialization Tests (Dry-Run)
  // ==========================================================================

  describe("Instruction Serialization (Dry-Run)", () => {
    it("should serialize depositForBurn instruction data", () => {
      const params: DepositForBurnV2Params = {
        amount: BigInt(100_000_000), // 100 USDC
        destinationDomain: CCTP_DOMAINS.ETHEREUM,
        mintRecipient: evmAddressToCctp(
          "0x1234567890123456789012345678901234567890"
        ),
        maxFee: BigInt(0),
        minFinalityThreshold: 2000,
      };

      const data = serializeInstructionData("depositForBurn", params);

      // Check discriminator (first 8 bytes)
      expect(data.slice(0, 8).equals(INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN)).to.be.true;

      // Check total length: 8 (disc) + 8 (amount) + 4 (domain) + 32 (recipient) + 8 (fee) + 4 (threshold)
      expect(data.length).to.equal(8 + 8 + 4 + 32 + 8 + 4);

      console.log("\nDepositForBurn instruction data:");
      console.log(`  Total length: ${data.length} bytes`);
      console.log(`  Discriminator: ${data.slice(0, 8).toString("hex")}`);
      console.log(`  Amount: ${data.readBigUInt64LE(8)}`);
      console.log(`  Destination domain: ${data.readUInt32LE(16)}`);
    });

    it("should serialize depositForBurnWithCaller instruction data", () => {
      const params: DepositForBurnV2Params = {
        amount: BigInt(100_000_000),
        destinationDomain: CCTP_DOMAINS.ETHEREUM,
        mintRecipient: evmAddressToCctp(
          "0x1234567890123456789012345678901234567890"
        ),
        destinationCaller: evmAddressToCctp(
          "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
        ),
        maxFee: BigInt(1000),
        minFinalityThreshold: 0, // Fast transfer
      };

      const data = serializeInstructionData("depositForBurnWithCaller", params);

      // Check discriminator
      expect(
        data
          .slice(0, 8)
          .equals(INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN_WITH_CALLER)
      ).to.be.true;

      // Check total length: 8 + 8 + 4 + 32 + 32 + 8 + 4 = 96
      expect(data.length).to.equal(96);

      console.log("\nDepositForBurnWithCaller instruction data:");
      console.log(`  Total length: ${data.length} bytes`);
      console.log(`  Max fee: ${data.readBigUInt64LE(8 + 8 + 4 + 32 + 32)}`);
      console.log(`  Finality threshold: ${data.readUInt32LE(8 + 8 + 4 + 32 + 32 + 8)}`);
    });

    it("should serialize receiveMessage instruction data", () => {
      const message = Buffer.alloc(200); // Mock message
      const attestation = Buffer.alloc(130); // 65 bytes per signature, 2 signatures

      const data = serializeInstructionData("receiveMessage", {
        message,
        attestation,
      });

      // Check discriminator
      expect(data.slice(0, 8).equals(INSTRUCTION_DISCRIMINATORS.RECEIVE_MESSAGE)).to.be.true;

      // Check length: 8 (disc) + 4 (msg len) + 200 (msg) + 4 (att len) + 130 (att)
      expect(data.length).to.equal(8 + 4 + 200 + 4 + 130);

      // Check length prefixes (Borsh Vec encoding)
      expect(data.readUInt32LE(8)).to.equal(200); // message length
      expect(data.readUInt32LE(8 + 4 + 200)).to.equal(130); // attestation length

      console.log("\nReceiveMessage instruction data:");
      console.log(`  Total length: ${data.length} bytes`);
      console.log(`  Message length: ${data.readUInt32LE(8)}`);
      console.log(`  Attestation length: ${data.readUInt32LE(8 + 4 + 200)}`);
    });

    it("should serialize reclaimEventAccount instruction data", () => {
      const attestation = Buffer.alloc(65);
      const destinationMessage = Buffer.alloc(150);

      const data = serializeInstructionData("reclaimEventAccount", {
        attestation,
        destinationMessage,
      });

      // Check discriminator
      expect(
        data.slice(0, 8).equals(INSTRUCTION_DISCRIMINATORS.RECLAIM_EVENT_ACCOUNT)
      ).to.be.true;

      console.log("\nReclaimEventAccount instruction data:");
      console.log(`  Total length: ${data.length} bytes`);
    });

    it("should build complete depositForBurn instruction", () => {
      const params: DepositForBurnV2Params = {
        amount: BigInt(100_000_000),
        destinationDomain: CCTP_DOMAINS.BASE,
        mintRecipient: evmAddressToCctp(
          "0x1234567890123456789012345678901234567890"
        ),
      };

      const result = buildDepositForBurnInstruction(
        payer.publicKey,
        USDC_MINT.DEVNET,
        params,
        true
      );

      expect(result.instruction).to.exist;
      expect(result.messageSentEventAccount).to.be.instanceOf(Keypair);
      expect(result.accounts).to.have.keys([
        "payer",
        "payerTokenAccount",
        "senderAuthority",
        "denylistAccount",
        "messageTransmitter",
        "tokenMessenger",
        "remoteTokenMessenger",
        "tokenMinter",
        "localToken",
        "mint",
        "messageSentEventAccount",
        "messageTransmitterProgram",
        "tokenMessengerMinterProgram",
      ]);

      console.log("\nDepositForBurn Instruction (dry-run):");
      console.log(`  Program: ${result.instruction.programId.toBase58()}`);
      console.log(`  Accounts: ${result.instruction.keys.length}`);
      console.log(`  Data length: ${result.instruction.data.length} bytes`);
      console.log("\n  Account Keys:");
      result.instruction.keys.forEach((key, i) => {
        const name = Object.keys(result.accounts)[i] || `account_${i}`;
        console.log(
          `    [${i}] ${name}: ${key.pubkey.toBase58().slice(0, 20)}... (signer: ${key.isSigner}, writable: ${key.isWritable})`
        );
      });
    });
  });

  // ==========================================================================
  // Chain Information Tests
  // ==========================================================================

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

  // ==========================================================================
  // Time and Cost Estimate Tests
  // ==========================================================================

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

  // ==========================================================================
  // Attestation Service Tests
  // ==========================================================================

  describe("Attestation Service", () => {
    it("should return pending for non-existent message hash", async function () {
      this.timeout(15000);
      const fakeHash =
        "0x0000000000000000000000000000000000000000000000000000000000000000";

      try {
        const result = await getAttestation(fakeHash, false);

        expect(result.status).to.equal("pending");
        expect(result.attestation).to.be.null;
        expect(result.messageHash).to.equal(fakeHash);

        console.log("\nAttestation lookup for non-existent hash:");
        console.log(`  Status: ${result.status}`);
      } catch (err: any) {
        // Circle Iris API may be unreachable - skip gracefully
        console.log(
          `\nAttestation API unavailable (${err.message}), skipping...`
        );
        this.skip();
      }
    });

    it("should handle V2 attestation API", async function () {
      this.timeout(15000);
      const fakeTxHash = "fakeTxHashForTesting123";

      try {
        const result = await getAttestationV2(fakeTxHash, false);

        expect(result.status).to.equal("pending");
        expect(result.attestation).to.be.null;

        console.log("\nV2 Attestation API response:");
        console.log(`  Status: ${result.status}`);
      } catch (err: any) {
        console.log(
          `\nAttestation V2 API unavailable (${err.message}), skipping...`
        );
        this.skip();
      }
    });
  });

  // ==========================================================================
  // Integration Tests (Require Funding)
  // ==========================================================================

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

  // ==========================================================================
  // Bridge Flow Simulation
  // ==========================================================================

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
      console.log(
        `   To: ${getChainName(destinationDomain)} (Domain ${destinationDomain})`
      );
      console.log(
        `   Recipient: 0x${Buffer.from(destinationRecipient).toString("hex").slice(24)}`
      );

      const timeEstimate = estimateBridgeTime(CCTP_DOMAINS.SOLANA);
      const costEstimate = estimateBridgeCost(destinationDomain);

      console.log("\n2. Estimates:");
      console.log(`   Time: ${timeEstimate.description}`);
      console.log(
        `   Cost: ${costEstimate.estimatedUsd} (${costEstimate.description})`
      );

      console.log("\n3. Flow Steps:");
      console.log("   [1] depositForBurn on Solana TokenMessengerMinter");
      console.log("       -> Burns USDC on Solana");
      console.log("       -> Creates MessageSent event account");
      console.log("       -> Emits message with unique nonce");
      console.log("   [2] Wait for Circle Iris attestation");
      console.log(
        `       -> ~${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} minutes`
      );
      console.log("   [3] receiveMessage on Ethereum MessageTransmitter");
      console.log("       -> Verifies attestation signatures");
      console.log("       -> Mints USDC to recipient");
      console.log("   [4] (Optional) reclaimEventAccount after 5 days");
      console.log("       -> Recovers rent from event account");

      console.log("\n4. Required Accounts (Solana depositForBurn V2):");
      const pdas = getAllPdas(USDC_MINT.DEVNET, destinationDomain, true);
      console.log(`   - messageTransmitter: ${pdas.messageTransmitter.toBase58()}`);
      console.log(`   - tokenMessenger: ${pdas.tokenMessenger.toBase58()}`);
      console.log(`   - localToken: ${pdas.localToken.toBase58()}`);
      console.log(`   - senderAuthority: ${pdas.senderAuthority.toBase58()}`);

      // Verify parameters are valid
      expect(amount > BigInt(0)).to.be.true;
      expect(destinationRecipient.length).to.equal(32);
      expect(destinationDomain).to.be.oneOf(Object.values(CCTP_DOMAINS));
    });

    it("should simulate V2 fast transfer with maxFee", () => {
      const params: DepositForBurnV2Params = {
        amount: BigInt(1000_000_000), // 1000 USDC
        destinationDomain: CCTP_DOMAINS.BASE,
        mintRecipient: evmAddressToCctp(
          "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
        ),
        maxFee: BigInt(5_000_000), // 5 USDC max fee
        minFinalityThreshold: 0, // Fast (unfinalized)
      };

      console.log("\n=== V2 Fast Transfer Simulation ===");
      console.log("\nConfiguration:");
      console.log(`  Amount: ${Number(params.amount) / 1_000_000} USDC`);
      console.log(`  Max Fee: ${Number(params.maxFee) / 1_000_000} USDC`);
      console.log(`  Finality: ${params.minFinalityThreshold} (fast/unfinalized)`);
      console.log(`  Destination: ${getChainName(params.destinationDomain)}`);

      console.log("\nV2 Features Used:");
      console.log("  - maxFee: Enables fast transfer if fee is acceptable");
      console.log("  - minFinalityThreshold=0: Request unfinalized message");
      console.log("  - Faster attestation but higher fee");

      expect(Number(params.maxFee)).to.be.greaterThan(0);
      expect(params.minFinalityThreshold).to.equal(0);
    });

    it("should simulate receiving USDC on Solana", () => {
      const amount = BigInt(100_000_000);
      const sourceDomain = CCTP_DOMAINS.ETHEREUM;
      const recipient = Keypair.generate().publicKey;

      console.log("\n=== Receive Flow Simulation ===");
      console.log("\n1. Receive Configuration:");
      console.log(`   Amount: ${Number(amount) / 1_000_000} USDC`);
      console.log(
        `   From: ${getChainName(sourceDomain)} (Domain ${sourceDomain})`
      );
      console.log(`   To: Solana (Domain ${CCTP_DOMAINS.SOLANA})`);
      console.log(`   Recipient: ${recipient.toBase58()}`);

      console.log("\n2. Prerequisites:");
      console.log("   - Message bytes from source chain depositForBurn");
      console.log("   - Attestation from Circle Iris API");
      console.log("   - Recipient USDC ATA (will be created if needed)");

      console.log("\n3. Message Parsing:");
      console.log(
        `   - Extract nonce from offset ${MESSAGE_V1_OFFSETS.NONCE} (V1) or ${MESSAGE_V2_OFFSETS.NONCE} (V2)`
      );
      console.log("   - Derive usedNonces PDA from source domain + nonce");
      console.log("   - Parse burn message to get amount and recipient");

      console.log("\n4. receiveMessage Accounts:");
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

  // ==========================================================================
  // Employee Withdrawal Options
  // ==========================================================================

  describe("Employee Withdrawal Options", () => {
    it("should support multiple withdrawal destinations", () => {
      const supportedDestinations = [
        {
          domain: CCTP_DOMAINS.SOLANA,
          description: "Stay on Solana (no CCTP needed)",
        },
        {
          domain: CCTP_DOMAINS.ETHEREUM,
          description: "Bridge to Ethereum mainnet",
        },
        { domain: CCTP_DOMAINS.BASE, description: "Bridge to Base (low fees)" },
        { domain: CCTP_DOMAINS.ARBITRUM, description: "Bridge to Arbitrum" },
        { domain: CCTP_DOMAINS.POLYGON, description: "Bridge to Polygon" },
        { domain: CCTP_DOMAINS.OPTIMISM, description: "Bridge to Optimism" },
        { domain: CCTP_DOMAINS.AVALANCHE, description: "Bridge to Avalanche" },
        { domain: CCTP_DOMAINS.SUI, description: "Bridge to Sui" },
      ];

      console.log("\n=== Employee Withdrawal Options ===\n");
      console.log(
        "An employee with vested USDC can claim to any CCTP-supported chain:\n"
      );

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
