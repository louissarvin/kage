/**
 * ShadowVest CCTP Bridge Library
 *
 * Enables cross-chain USDC transfers using Circle's Cross-Chain Transfer Protocol (CCTP).
 * USDC is burned on the source chain and minted on the destination chain.
 *
 * Supports both CCTP V1 and V2 protocols with proper message parsing and verification.
 *
 * Documentation:
 * - CCTP Docs: https://developers.circle.com/cctp
 * - Solana Contracts: https://github.com/circlefin/solana-cctp-contracts
 * - Iris API: https://developers.circle.com/api-reference/cctp/all/get-attestation
 *
 * V2 Features:
 * - maxFee parameter for fast transfers
 * - minFinalityThreshold for finality control
 * - hookData for custom destination logic
 * - 32-byte nonce extraction (vs 8-byte in V1)
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { createHash } from "crypto";

// =============================================================================
// Constants
// =============================================================================

/**
 * CCTP Program IDs on Solana
 */
export const CCTP_PROGRAMS = {
  // V1 Programs (Legacy)
  MESSAGE_TRANSMITTER_V1: new PublicKey(
    "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd"
  ),
  TOKEN_MESSENGER_MINTER_V1: new PublicKey(
    "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3"
  ),
  // V2 Programs (Current)
  MESSAGE_TRANSMITTER: new PublicKey(
    "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
  ),
  TOKEN_MESSENGER_MINTER: new PublicKey(
    "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
  ),
};

/**
 * USDC Mint addresses on Solana
 */
export const USDC_MINT = {
  MAINNET: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  DEVNET: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
};

/**
 * CCTP Domain IDs for supported chains
 */
export const CCTP_DOMAINS = {
  ETHEREUM: 0,
  AVALANCHE: 1,
  OPTIMISM: 2,
  ARBITRUM: 3,
  NOBLE: 4, // Cosmos
  SOLANA: 5,
  BASE: 6,
  POLYGON: 7,
  SUI: 8,
} as const;

export type CctpDomain = (typeof CCTP_DOMAINS)[keyof typeof CCTP_DOMAINS];

/**
 * Circle Iris Attestation API endpoints
 */
export const IRIS_API = {
  MAINNET: "https://iris-api.circle.com",
  TESTNET: "https://iris-api-sandbox.circle.com",
};

/**
 * Chain information for display and configuration
 */
export const CHAIN_INFO: Record<
  CctpDomain,
  { name: string; explorer: string; usdcAddress: string }
> = {
  [CCTP_DOMAINS.ETHEREUM]: {
    name: "Ethereum",
    explorer: "https://etherscan.io",
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  [CCTP_DOMAINS.AVALANCHE]: {
    name: "Avalanche",
    explorer: "https://snowtrace.io",
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  },
  [CCTP_DOMAINS.OPTIMISM]: {
    name: "Optimism",
    explorer: "https://optimistic.etherscan.io",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
  [CCTP_DOMAINS.ARBITRUM]: {
    name: "Arbitrum",
    explorer: "https://arbiscan.io",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  [CCTP_DOMAINS.NOBLE]: {
    name: "Noble (Cosmos)",
    explorer: "https://www.mintscan.io/noble",
    usdcAddress: "uusdc",
  },
  [CCTP_DOMAINS.SOLANA]: {
    name: "Solana",
    explorer: "https://solscan.io",
    usdcAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  [CCTP_DOMAINS.BASE]: {
    name: "Base",
    explorer: "https://basescan.org",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  [CCTP_DOMAINS.POLYGON]: {
    name: "Polygon",
    explorer: "https://polygonscan.com",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  [CCTP_DOMAINS.SUI]: {
    name: "Sui",
    explorer: "https://suiscan.xyz",
    usdcAddress:
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  },
};

// =============================================================================
// CCTP Message Format Constants
// =============================================================================

/**
 * CCTP V1 Message byte offsets (8-byte nonce)
 * Message format: version || source_domain || dest_domain || nonce || sender || recipient || destination_caller || message_body
 */
export const MESSAGE_V1_OFFSETS = {
  VERSION: 0,
  VERSION_SIZE: 4,
  SOURCE_DOMAIN: 4,
  SOURCE_DOMAIN_SIZE: 4,
  DESTINATION_DOMAIN: 8,
  DESTINATION_DOMAIN_SIZE: 4,
  NONCE: 12,
  NONCE_SIZE: 8,
  SENDER: 20,
  SENDER_SIZE: 32,
  RECIPIENT: 52,
  RECIPIENT_SIZE: 32,
  DESTINATION_CALLER: 84,
  DESTINATION_CALLER_SIZE: 32,
  MESSAGE_BODY: 116,
} as const;

/**
 * CCTP V2 Message byte offsets (32-byte nonce)
 * Note: V2 uses off-chain nonce generation with extended nonce space
 */
export const MESSAGE_V2_OFFSETS = {
  VERSION: 0,
  VERSION_SIZE: 4,
  SOURCE_DOMAIN: 4,
  SOURCE_DOMAIN_SIZE: 4,
  DESTINATION_DOMAIN: 8,
  DESTINATION_DOMAIN_SIZE: 4,
  NONCE: 12,
  NONCE_SIZE: 32, // V2 uses 32-byte nonce
  SENDER: 44,
  SENDER_SIZE: 32,
  RECIPIENT: 76,
  RECIPIENT_SIZE: 32,
  DESTINATION_CALLER: 108,
  DESTINATION_CALLER_SIZE: 32,
  FINALITY_THRESHOLD: 140,
  FINALITY_THRESHOLD_SIZE: 4,
  MESSAGE_BODY: 144,
} as const;

/**
 * BurnMessage body offsets within the message body
 */
export const BURN_MESSAGE_OFFSETS = {
  VERSION: 0,
  VERSION_SIZE: 4,
  BURN_TOKEN: 4,
  BURN_TOKEN_SIZE: 32,
  MINT_RECIPIENT: 36,
  MINT_RECIPIENT_SIZE: 32,
  AMOUNT: 68,
  AMOUNT_SIZE: 32, // u256 big-endian
  MESSAGE_SENDER: 100,
  MESSAGE_SENDER_SIZE: 32,
} as const;

/**
 * MessageSent event account structure offsets
 */
export const MESSAGE_SENT_ACCOUNT_OFFSETS = {
  // V1 structure
  V1_DISCRIMINATOR: 0,
  V1_DISCRIMINATOR_SIZE: 8,
  V1_RENT_PAYER: 8,
  V1_RENT_PAYER_SIZE: 32,
  V1_MESSAGE_START: 40,

  // V2 structure (includes created_at timestamp)
  V2_DISCRIMINATOR: 0,
  V2_DISCRIMINATOR_SIZE: 8,
  V2_RENT_PAYER: 8,
  V2_RENT_PAYER_SIZE: 32,
  V2_CREATED_AT: 40,
  V2_CREATED_AT_SIZE: 8,
  V2_MESSAGE_START: 48,
} as const;

// =============================================================================
// Anchor Instruction Discriminators
// =============================================================================

/**
 * Compute Anchor instruction discriminator
 * Anchor uses SHA256("global:<instruction_name>")[0:8]
 */
function computeDiscriminator(instructionName: string): Buffer {
  const hash = createHash("sha256")
    .update(`global:${instructionName}`)
    .digest();
  return hash.slice(0, 8);
}

/**
 * Pre-computed Anchor instruction discriminators for CCTP programs
 */
export const INSTRUCTION_DISCRIMINATORS = {
  // TokenMessengerMinter V2 instructions
  DEPOSIT_FOR_BURN: computeDiscriminator("deposit_for_burn"),
  DEPOSIT_FOR_BURN_WITH_CALLER: computeDiscriminator(
    "deposit_for_burn_with_caller"
  ),
  DEPOSIT_FOR_BURN_WITH_HOOK: computeDiscriminator("deposit_for_burn_with_hook"),
  HANDLE_RECEIVE_MESSAGE: computeDiscriminator("handle_receive_message"),
  HANDLE_RECEIVE_FINALIZED_MESSAGE: computeDiscriminator(
    "handle_receive_finalized_message"
  ),
  HANDLE_RECEIVE_UNFINALIZED_MESSAGE: computeDiscriminator(
    "handle_receive_unfinalized_message"
  ),

  // MessageTransmitter V2 instructions
  RECEIVE_MESSAGE: computeDiscriminator("receive_message"),
  SEND_MESSAGE: computeDiscriminator("send_message"),
  SEND_MESSAGE_WITH_CALLER: computeDiscriminator("send_message_with_caller"),
  RECLAIM_EVENT_ACCOUNT: computeDiscriminator("reclaim_event_account"),
} as const;

// =============================================================================
// Types
// =============================================================================

export interface BridgeConfig {
  /** Solana RPC endpoint */
  rpcEndpoint: string;
  /** Use mainnet (true) or testnet (false) */
  isMainnet: boolean;
  /** Use V2 programs (default: true) */
  useV2?: boolean;
}

export interface DepositForBurnParams {
  /** Amount of USDC to bridge (in smallest units, 6 decimals) */
  amount: bigint;
  /** Destination chain domain ID */
  destinationDomain: CctpDomain;
  /**
   * Recipient address on destination chain (32 bytes)
   * - For EVM: 20-byte address padded to 32 bytes (left-padded with zeros)
   * - For Solana: 32-byte public key
   */
  mintRecipient: Uint8Array;
  /** Optional: specific caller allowed to receive on destination (32 bytes) */
  destinationCaller?: Uint8Array;
}

export interface DepositForBurnV2Params extends DepositForBurnParams {
  /** Maximum fee willing to pay for fast transfer (default: 0) */
  maxFee?: bigint;
  /**
   * Minimum finality threshold for attestation
   * - 0: Fast (unfinalized) message
   * - 2000+: Normal finalized message
   * Default: 2000 (finalized)
   */
  minFinalityThreshold?: number;
  /** Optional hook data for custom destination logic */
  hookData?: Uint8Array;
}

export interface DepositForBurnResult {
  /** Transaction signature on Solana */
  signature: string;
  /** Message hash for attestation lookup (keccak256 of message bytes) */
  messageHash: string;
  /** Message bytes (needed for receiveMessage) */
  message: Uint8Array;
  /** MessageSent event account public key */
  messageSentEventAccount: PublicKey;
  /** Nonce of the message */
  nonce: bigint;
  /** Amount burned */
  amount: bigint;
  /** Destination domain */
  destinationDomain: CctpDomain;
}

export interface AttestationResult {
  /** Attestation status */
  status: "pending" | "complete";
  /** Signed attestation bytes (if complete) */
  attestation: Uint8Array | null;
  /** Message hash */
  messageHash: string;
}

export interface ReceiveMessageParams {
  /** Original message from depositForBurn */
  message: Uint8Array;
  /** Signed attestation from Iris API */
  attestation: Uint8Array;
}

export interface ReceiveMessageResult {
  /** Transaction signature */
  signature: string;
  /** Amount received */
  amount: bigint;
  /** Recipient's token account */
  recipientTokenAccount: PublicKey;
}

export interface ReclaimEventAccountParams {
  /** MessageSent event account to reclaim rent from */
  messageSentEventAccount: PublicKey;
  /** Attestation bytes (proves message was processed) */
  attestation: Uint8Array;
  /** Destination message bytes */
  destinationMessage: Uint8Array;
}

export interface ReclaimEventAccountResult {
  /** Transaction signature */
  signature: string;
  /** Amount of SOL reclaimed */
  lamportsReclaimed: bigint;
}

/**
 * Parsed CCTP message structure
 */
export interface ParsedCctpMessage {
  /** Protocol version */
  version: number;
  /** Source chain domain ID */
  sourceDomain: number;
  /** Destination chain domain ID */
  destinationDomain: number;
  /** Message nonce */
  nonce: bigint;
  /** Sender address (32 bytes) */
  sender: Uint8Array;
  /** Recipient address (32 bytes) */
  recipient: Uint8Array;
  /** Destination caller (32 bytes, all zeros if not specified) */
  destinationCaller: Uint8Array;
  /** Finality threshold (V2 only) */
  finalityThreshold?: number;
  /** Message body (burn message or custom) */
  messageBody: Uint8Array;
  /** Raw message bytes */
  raw: Uint8Array;
}

/**
 * Parsed burn message structure (within message body)
 */
export interface ParsedBurnMessage {
  /** Burn message version */
  version: number;
  /** Burn token address (32 bytes) */
  burnToken: Uint8Array;
  /** Mint recipient address (32 bytes) */
  mintRecipient: Uint8Array;
  /** Amount (as bigint from u256) */
  amount: bigint;
  /** Message sender (32 bytes) */
  messageSender: Uint8Array;
}

// =============================================================================
// PDA Derivation
// =============================================================================

/**
 * Get the appropriate program IDs based on version
 */
function getPrograms(useV2: boolean = true) {
  return {
    messageTransmitter: useV2
      ? CCTP_PROGRAMS.MESSAGE_TRANSMITTER
      : CCTP_PROGRAMS.MESSAGE_TRANSMITTER_V1,
    tokenMessengerMinter: useV2
      ? CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER
      : CCTP_PROGRAMS.TOKEN_MESSENGER_MINTER_V1,
  };
}

/**
 * Derive PDA for message transmitter state
 */
export function findMessageTransmitterPda(
  useV2: boolean = true
): [PublicKey, number] {
  const { messageTransmitter } = getPrograms(useV2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter")],
    messageTransmitter
  );
}

/**
 * Derive PDA for token messenger
 */
export function findTokenMessengerPda(
  useV2: boolean = true
): [PublicKey, number] {
  const { tokenMessengerMinter } = getPrograms(useV2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_messenger")],
    tokenMessengerMinter
  );
}

/**
 * Derive PDA for token minter
 */
export function findTokenMinterPda(useV2: boolean = true): [PublicKey, number] {
  const { tokenMessengerMinter } = getPrograms(useV2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_minter")],
    tokenMessengerMinter
  );
}

/**
 * Derive PDA for local token (USDC on Solana)
 */
export function findLocalTokenPda(
  mint: PublicKey,
  useV2: boolean = true
): [PublicKey, number] {
  const { tokenMessengerMinter } = getPrograms(useV2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("local_token"), mint.toBuffer()],
    tokenMessengerMinter
  );
}

/**
 * Derive PDA for remote token messenger
 */
export function findRemoteTokenMessengerPda(
  remoteDomain: number,
  useV2: boolean = true
): [PublicKey, number] {
  const { tokenMessengerMinter } = getPrograms(useV2);
  const domainBuffer = Buffer.alloc(4);
  domainBuffer.writeUInt32LE(remoteDomain, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("remote_token_messenger"), domainBuffer],
    tokenMessengerMinter
  );
}

/**
 * Derive PDA for sender authority
 */
export function findSenderAuthorityPda(
  useV2: boolean = true
): [PublicKey, number] {
  const { tokenMessengerMinter } = getPrograms(useV2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sender_authority")],
    tokenMessengerMinter
  );
}

/**
 * Derive PDA for custody token account
 */
export function findCustodyTokenAccountPda(
  mint: PublicKey,
  useV2: boolean = true
): [PublicKey, number] {
  const { tokenMessengerMinter } = getPrograms(useV2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("custody"), mint.toBuffer()],
    tokenMessengerMinter
  );
}

/**
 * Derive PDA for token pair (source domain + source token)
 */
export function findTokenPairPda(
  sourceDomain: number,
  sourceToken: Uint8Array,
  useV2: boolean = true
): [PublicKey, number] {
  const { tokenMessengerMinter } = getPrograms(useV2);
  const domainBuffer = Buffer.alloc(4);
  domainBuffer.writeUInt32LE(sourceDomain, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_pair"), domainBuffer, Buffer.from(sourceToken)],
    tokenMessengerMinter
  );
}

/**
 * Derive PDA for used nonces (V1 - 8-byte nonce)
 */
export function findUsedNoncesPdaV1(
  sourceDomain: number,
  nonce: bigint
): [PublicKey, number] {
  const { messageTransmitter } = getPrograms(false);
  const domainBuffer = Buffer.alloc(4);
  domainBuffer.writeUInt32LE(sourceDomain, 0);

  // V1 uses first_nonce (nonce / 6400) for account derivation
  const firstNonce = nonce / BigInt(6400);
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(firstNonce, 0);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("used_nonces"), domainBuffer, nonceBuffer],
    messageTransmitter
  );
}

/**
 * Derive PDA for used nonces (V2 - 32-byte nonce)
 */
export function findUsedNoncesPdaV2(
  sourceDomain: number,
  nonce: bigint
): [PublicKey, number] {
  const { messageTransmitter } = getPrograms(true);
  const domainBuffer = Buffer.alloc(4);
  domainBuffer.writeUInt32LE(sourceDomain, 0);

  // V2 uses the nonce directly (32 bytes, but we use 8 for derivation)
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(nonce, 0);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("used_nonces"), domainBuffer, nonceBuffer],
    messageTransmitter
  );
}

/**
 * Derive PDA for authority in message transmitter
 */
export function findAuthorityPda(
  receiver: PublicKey,
  useV2: boolean = true
): [PublicKey, number] {
  const { messageTransmitter } = getPrograms(useV2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter_authority"), receiver.toBuffer()],
    messageTransmitter
  );
}

/**
 * Derive PDA for denylist account
 */
export function findDenylistPda(
  account: PublicKey,
  useV2: boolean = true
): [PublicKey, number] {
  const { tokenMessengerMinter } = getPrograms(useV2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("denylist"), account.toBuffer()],
    tokenMessengerMinter
  );
}

// =============================================================================
// Message Parsing
// =============================================================================

/**
 * Detect CCTP message version from raw bytes
 */
export function detectMessageVersion(message: Uint8Array): 1 | 2 {
  if (message.length < 4) {
    throw new Error("Message too short to determine version");
  }
  const version = Buffer.from(message.slice(0, 4)).readUInt32BE(0);
  if (version === 0 || version === 1) {
    return 1;
  }
  return 2;
}

/**
 * Parse CCTP V1 message
 */
export function parseMessageV1(message: Uint8Array): ParsedCctpMessage {
  const buffer = Buffer.from(message);

  if (buffer.length < MESSAGE_V1_OFFSETS.MESSAGE_BODY) {
    throw new Error(
      `Invalid V1 message length: ${buffer.length} < ${MESSAGE_V1_OFFSETS.MESSAGE_BODY}`
    );
  }

  const version = buffer.readUInt32BE(MESSAGE_V1_OFFSETS.VERSION);
  const sourceDomain = buffer.readUInt32BE(MESSAGE_V1_OFFSETS.SOURCE_DOMAIN);
  const destinationDomain = buffer.readUInt32BE(
    MESSAGE_V1_OFFSETS.DESTINATION_DOMAIN
  );
  const nonce = buffer.readBigUInt64BE(MESSAGE_V1_OFFSETS.NONCE);
  const sender = new Uint8Array(
    buffer.slice(
      MESSAGE_V1_OFFSETS.SENDER,
      MESSAGE_V1_OFFSETS.SENDER + MESSAGE_V1_OFFSETS.SENDER_SIZE
    )
  );
  const recipient = new Uint8Array(
    buffer.slice(
      MESSAGE_V1_OFFSETS.RECIPIENT,
      MESSAGE_V1_OFFSETS.RECIPIENT + MESSAGE_V1_OFFSETS.RECIPIENT_SIZE
    )
  );
  const destinationCaller = new Uint8Array(
    buffer.slice(
      MESSAGE_V1_OFFSETS.DESTINATION_CALLER,
      MESSAGE_V1_OFFSETS.DESTINATION_CALLER +
        MESSAGE_V1_OFFSETS.DESTINATION_CALLER_SIZE
    )
  );
  const messageBody = new Uint8Array(
    buffer.slice(MESSAGE_V1_OFFSETS.MESSAGE_BODY)
  );

  return {
    version,
    sourceDomain,
    destinationDomain,
    nonce,
    sender,
    recipient,
    destinationCaller,
    messageBody,
    raw: message,
  };
}

/**
 * Parse CCTP V2 message
 */
export function parseMessageV2(message: Uint8Array): ParsedCctpMessage {
  const buffer = Buffer.from(message);

  if (buffer.length < MESSAGE_V2_OFFSETS.MESSAGE_BODY) {
    throw new Error(
      `Invalid V2 message length: ${buffer.length} < ${MESSAGE_V2_OFFSETS.MESSAGE_BODY}`
    );
  }

  const version = buffer.readUInt32BE(MESSAGE_V2_OFFSETS.VERSION);
  const sourceDomain = buffer.readUInt32BE(MESSAGE_V2_OFFSETS.SOURCE_DOMAIN);
  const destinationDomain = buffer.readUInt32BE(
    MESSAGE_V2_OFFSETS.DESTINATION_DOMAIN
  );

  // V2 uses 32-byte nonce, but we read the first 8 bytes as bigint
  // (Full 32-byte nonce is used for unique identification)
  const nonceBuffer = buffer.slice(
    MESSAGE_V2_OFFSETS.NONCE,
    MESSAGE_V2_OFFSETS.NONCE + 8
  );
  const nonce = nonceBuffer.readBigUInt64BE(0);

  const sender = new Uint8Array(
    buffer.slice(
      MESSAGE_V2_OFFSETS.SENDER,
      MESSAGE_V2_OFFSETS.SENDER + MESSAGE_V2_OFFSETS.SENDER_SIZE
    )
  );
  const recipient = new Uint8Array(
    buffer.slice(
      MESSAGE_V2_OFFSETS.RECIPIENT,
      MESSAGE_V2_OFFSETS.RECIPIENT + MESSAGE_V2_OFFSETS.RECIPIENT_SIZE
    )
  );
  const destinationCaller = new Uint8Array(
    buffer.slice(
      MESSAGE_V2_OFFSETS.DESTINATION_CALLER,
      MESSAGE_V2_OFFSETS.DESTINATION_CALLER +
        MESSAGE_V2_OFFSETS.DESTINATION_CALLER_SIZE
    )
  );
  const finalityThreshold = buffer.readUInt32BE(
    MESSAGE_V2_OFFSETS.FINALITY_THRESHOLD
  );
  const messageBody = new Uint8Array(
    buffer.slice(MESSAGE_V2_OFFSETS.MESSAGE_BODY)
  );

  return {
    version,
    sourceDomain,
    destinationDomain,
    nonce,
    sender,
    recipient,
    destinationCaller,
    finalityThreshold,
    messageBody,
    raw: message,
  };
}

/**
 * Parse CCTP message (auto-detects version)
 */
export function parseMessage(message: Uint8Array): ParsedCctpMessage {
  const version = detectMessageVersion(message);
  return version === 1 ? parseMessageV1(message) : parseMessageV2(message);
}

/**
 * Parse burn message from message body
 */
export function parseBurnMessage(messageBody: Uint8Array): ParsedBurnMessage {
  const buffer = Buffer.from(messageBody);

  if (buffer.length < 132) {
    throw new Error(`Invalid burn message length: ${buffer.length} < 132`);
  }

  const version = buffer.readUInt32BE(BURN_MESSAGE_OFFSETS.VERSION);
  const burnToken = new Uint8Array(
    buffer.slice(
      BURN_MESSAGE_OFFSETS.BURN_TOKEN,
      BURN_MESSAGE_OFFSETS.BURN_TOKEN + BURN_MESSAGE_OFFSETS.BURN_TOKEN_SIZE
    )
  );
  const mintRecipient = new Uint8Array(
    buffer.slice(
      BURN_MESSAGE_OFFSETS.MINT_RECIPIENT,
      BURN_MESSAGE_OFFSETS.MINT_RECIPIENT +
        BURN_MESSAGE_OFFSETS.MINT_RECIPIENT_SIZE
    )
  );

  // Amount is 32 bytes (u256) big-endian, but we read last 8 bytes as USDC max is u64
  const amountOffset = BURN_MESSAGE_OFFSETS.AMOUNT;
  const amountBuffer = buffer.slice(
    amountOffset,
    amountOffset + BURN_MESSAGE_OFFSETS.AMOUNT_SIZE
  );
  // Read the last 8 bytes as u64 (USDC amount fits in u64)
  const amount = amountBuffer.slice(24).readBigUInt64BE(0);

  const messageSender = new Uint8Array(
    buffer.slice(
      BURN_MESSAGE_OFFSETS.MESSAGE_SENDER,
      BURN_MESSAGE_OFFSETS.MESSAGE_SENDER +
        BURN_MESSAGE_OFFSETS.MESSAGE_SENDER_SIZE
    )
  );

  return {
    version,
    burnToken,
    mintRecipient,
    amount,
    messageSender,
  };
}

/**
 * Extract message bytes from MessageSent event account data
 */
export function extractMessageFromEventAccount(
  accountData: Buffer,
  isV2: boolean = true
): Uint8Array {
  const messageStart = isV2
    ? MESSAGE_SENT_ACCOUNT_OFFSETS.V2_MESSAGE_START
    : MESSAGE_SENT_ACCOUNT_OFFSETS.V1_MESSAGE_START;

  if (accountData.length <= messageStart) {
    throw new Error(
      `Event account data too short: ${accountData.length} <= ${messageStart}`
    );
  }

  // The remaining bytes after the header are the message
  // First 4 bytes of message data is the length prefix (Borsh Vec encoding)
  const lengthPrefix = accountData.readUInt32LE(messageStart);
  const messageBytes = accountData.slice(
    messageStart + 4,
    messageStart + 4 + lengthPrefix
  );

  return new Uint8Array(messageBytes);
}

/**
 * Compute keccak256 hash of message bytes
 * Note: Uses Node.js crypto for development. In production, use a proper keccak256 implementation
 */
export function computeMessageHash(message: Uint8Array): string {
  // Use sha3-256 as a stand-in for keccak256 in development
  // In production, use ethers.js keccak256 or similar
  const hash = createHash("sha256").update(Buffer.from(message)).digest();
  return "0x" + hash.toString("hex");
}

/**
 * Compute keccak256 hash using proper keccak (requires keccak package)
 * This is the correct implementation for attestation lookup
 */
export function computeMessageHashKeccak(message: Uint8Array): string {
  try {
    // Try to use keccak256 from ethers or web3 if available
    const { keccak256 } = require("ethers");
    return keccak256(message);
  } catch {
    // Fallback to sha256 (won't work for attestation lookup but useful for testing)
    console.warn(
      "Warning: Using SHA256 instead of keccak256. Install ethers for correct hash."
    );
    return computeMessageHash(message);
  }
}

// =============================================================================
// Instruction Building
// =============================================================================

/**
 * Build depositForBurn instruction data (V2)
 */
function buildDepositForBurnInstructionData(
  params: DepositForBurnV2Params
): Buffer {
  // Instruction layout:
  // - discriminator (8 bytes)
  // - amount (8 bytes, u64 LE)
  // - destination_domain (4 bytes, u32 LE)
  // - mint_recipient (32 bytes)
  // - max_fee (8 bytes, u64 LE)
  // - min_finality_threshold (4 bytes, u32 LE)

  const data = Buffer.alloc(8 + 8 + 4 + 32 + 8 + 4);
  let offset = 0;

  // Discriminator
  INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN.copy(data, offset);
  offset += 8;

  // Amount (u64 LE)
  data.writeBigUInt64LE(params.amount, offset);
  offset += 8;

  // Destination domain (u32 LE)
  data.writeUInt32LE(params.destinationDomain, offset);
  offset += 4;

  // Mint recipient (32 bytes)
  Buffer.from(params.mintRecipient).copy(data, offset);
  offset += 32;

  // Max fee (u64 LE)
  data.writeBigUInt64LE(params.maxFee || BigInt(0), offset);
  offset += 8;

  // Min finality threshold (u32 LE) - default 2000 for finalized
  data.writeUInt32LE(params.minFinalityThreshold ?? 2000, offset);

  return data;
}

/**
 * Build depositForBurnWithCaller instruction data (V2)
 */
function buildDepositForBurnWithCallerInstructionData(
  params: DepositForBurnV2Params
): Buffer {
  // Same as depositForBurn but with destination_caller
  // Instruction layout:
  // - discriminator (8 bytes)
  // - amount (8 bytes, u64 LE)
  // - destination_domain (4 bytes, u32 LE)
  // - mint_recipient (32 bytes)
  // - destination_caller (32 bytes)
  // - max_fee (8 bytes, u64 LE)
  // - min_finality_threshold (4 bytes, u32 LE)

  const data = Buffer.alloc(8 + 8 + 4 + 32 + 32 + 8 + 4);
  let offset = 0;

  // Discriminator
  INSTRUCTION_DISCRIMINATORS.DEPOSIT_FOR_BURN_WITH_CALLER.copy(data, offset);
  offset += 8;

  // Amount (u64 LE)
  data.writeBigUInt64LE(params.amount, offset);
  offset += 8;

  // Destination domain (u32 LE)
  data.writeUInt32LE(params.destinationDomain, offset);
  offset += 4;

  // Mint recipient (32 bytes)
  Buffer.from(params.mintRecipient).copy(data, offset);
  offset += 32;

  // Destination caller (32 bytes)
  if (params.destinationCaller) {
    Buffer.from(params.destinationCaller).copy(data, offset);
  }
  offset += 32;

  // Max fee (u64 LE)
  data.writeBigUInt64LE(params.maxFee || BigInt(0), offset);
  offset += 8;

  // Min finality threshold (u32 LE)
  data.writeUInt32LE(params.minFinalityThreshold ?? 2000, offset);

  return data;
}

/**
 * Build receiveMessage instruction data
 */
function buildReceiveMessageInstructionData(
  message: Uint8Array,
  attestation: Uint8Array
): Buffer {
  // Instruction layout:
  // - discriminator (8 bytes)
  // - message (4 bytes length + data, Borsh Vec)
  // - attestation (4 bytes length + data, Borsh Vec)

  const messageLen = message.length;
  const attestationLen = attestation.length;
  const dataLength = 8 + 4 + messageLen + 4 + attestationLen;
  const data = Buffer.alloc(dataLength);
  let offset = 0;

  // Discriminator
  INSTRUCTION_DISCRIMINATORS.RECEIVE_MESSAGE.copy(data, offset);
  offset += 8;

  // Message (Borsh Vec: 4-byte length prefix + data)
  data.writeUInt32LE(messageLen, offset);
  offset += 4;
  Buffer.from(message).copy(data, offset);
  offset += messageLen;

  // Attestation (Borsh Vec: 4-byte length prefix + data)
  data.writeUInt32LE(attestationLen, offset);
  offset += 4;
  Buffer.from(attestation).copy(data, offset);

  return data;
}

/**
 * Build reclaimEventAccount instruction data
 */
function buildReclaimEventAccountInstructionData(
  attestation: Uint8Array,
  destinationMessage: Uint8Array
): Buffer {
  // Instruction layout:
  // - discriminator (8 bytes)
  // - attestation (4 bytes length + data, Borsh Vec)
  // - destination_message (4 bytes length + data, Borsh Vec)

  const attestationLen = attestation.length;
  const messageLen = destinationMessage.length;
  const dataLength = 8 + 4 + attestationLen + 4 + messageLen;
  const data = Buffer.alloc(dataLength);
  let offset = 0;

  // Discriminator
  INSTRUCTION_DISCRIMINATORS.RECLAIM_EVENT_ACCOUNT.copy(data, offset);
  offset += 8;

  // Attestation (Borsh Vec)
  data.writeUInt32LE(attestationLen, offset);
  offset += 4;
  Buffer.from(attestation).copy(data, offset);
  offset += attestationLen;

  // Destination message (Borsh Vec)
  data.writeUInt32LE(messageLen, offset);
  offset += 4;
  Buffer.from(destinationMessage).copy(data, offset);

  return data;
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Bridge USDC from Solana to another chain (V2)
 *
 * This burns USDC on Solana. After the transaction confirms and Circle's
 * Iris service signs the attestation, the recipient can claim on the
 * destination chain.
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer and USDC owner
 * @param params - Bridge parameters
 * @param config - Bridge configuration
 * @returns Deposit result with message hash for attestation lookup
 */
export async function bridgeUsdcFromSolana(
  connection: Connection,
  payer: Keypair,
  params: DepositForBurnV2Params,
  config: BridgeConfig
): Promise<DepositForBurnResult> {
  const useV2 = config.useV2 !== false;
  const mint = config.isMainnet ? USDC_MINT.MAINNET : USDC_MINT.DEVNET;
  const programs = getPrograms(useV2);

  // Get payer's USDC token account
  const payerTokenAccount = await getAssociatedTokenAddress(
    mint,
    payer.publicKey
  );

  // Derive required PDAs
  const [messageTransmitter] = findMessageTransmitterPda(useV2);
  const [tokenMessenger] = findTokenMessengerPda(useV2);
  const [tokenMinter] = findTokenMinterPda(useV2);
  const [localToken] = findLocalTokenPda(mint, useV2);
  const [remoteTokenMessenger] = findRemoteTokenMessengerPda(
    params.destinationDomain,
    useV2
  );
  const [senderAuthority] = findSenderAuthorityPda(useV2);
  const [denylistAccount] = findDenylistPda(payer.publicKey, useV2);

  // Create a keypair for the message sent event account
  const messageSentEventAccount = Keypair.generate();

  // Build instruction data based on whether destination caller is specified
  const hasDestinationCaller =
    params.destinationCaller &&
    !Buffer.from(params.destinationCaller).equals(Buffer.alloc(32));

  const instructionData = hasDestinationCaller
    ? buildDepositForBurnWithCallerInstructionData(params)
    : buildDepositForBurnInstructionData(params);

  // Build the instruction
  const depositForBurnIx = new TransactionInstruction({
    programId: programs.tokenMessengerMinter,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // owner
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // event_rent_payer
      { pubkey: senderAuthority, isSigner: false, isWritable: false }, // sender_authority_pda
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true }, // burn_token_account
      { pubkey: denylistAccount, isSigner: false, isWritable: false }, // denylist_account
      { pubkey: messageTransmitter, isSigner: false, isWritable: true }, // message_transmitter
      { pubkey: tokenMessenger, isSigner: false, isWritable: false }, // token_messenger
      { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false }, // remote_token_messenger
      { pubkey: tokenMinter, isSigner: false, isWritable: false }, // token_minter
      { pubkey: localToken, isSigner: false, isWritable: true }, // local_token
      { pubkey: mint, isSigner: false, isWritable: true }, // burn_token_mint
      {
        pubkey: messageSentEventAccount.publicKey,
        isSigner: true,
        isWritable: true,
      }, // message_sent_event_data
      {
        pubkey: programs.messageTransmitter,
        isSigner: false,
        isWritable: false,
      }, // message_transmitter_program
      {
        pubkey: programs.tokenMessengerMinter,
        isSigner: false,
        isWritable: false,
      }, // token_messenger_minter_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data: instructionData,
  });

  // Add compute budget for complex transaction
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 300_000,
  });

  // Build and send transaction
  const transaction = new Transaction()
    .add(computeBudgetIx)
    .add(depositForBurnIx);

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    payer,
    messageSentEventAccount,
  ]);

  // Fetch the MessageSent event account to extract message bytes
  const eventAccountInfo = await connection.getAccountInfo(
    messageSentEventAccount.publicKey
  );

  if (!eventAccountInfo) {
    throw new Error("Failed to fetch MessageSent event account");
  }

  // Extract message bytes from event account
  const messageBytes = extractMessageFromEventAccount(
    eventAccountInfo.data,
    useV2
  );

  // Parse the message to get nonce
  const parsedMessage = parseMessage(messageBytes);

  // Compute message hash for attestation lookup
  const messageHash = computeMessageHashKeccak(messageBytes);

  return {
    signature,
    messageHash,
    message: messageBytes,
    messageSentEventAccount: messageSentEventAccount.publicKey,
    nonce: parsedMessage.nonce,
    amount: params.amount,
    destinationDomain: params.destinationDomain,
  };
}

/**
 * Fetch attestation from Circle's Iris API
 *
 * After a depositForBurn transaction, Circle's attestation service
 * observes the burn and signs an attestation. This process typically
 * takes 15-30 minutes depending on source chain finality.
 *
 * @param messageHash - Message hash from depositForBurn
 * @param isMainnet - Use mainnet or testnet Iris API
 * @returns Attestation result
 */
export async function getAttestation(
  messageHash: string,
  isMainnet: boolean = false
): Promise<AttestationResult> {
  const baseUrl = isMainnet ? IRIS_API.MAINNET : IRIS_API.TESTNET;
  // Normalize hash format (ensure 0x prefix)
  const normalizedHash = messageHash.startsWith("0x")
    ? messageHash
    : `0x${messageHash}`;
  const url = `${baseUrl}/v1/attestations/${normalizedHash}`;

  const response = await fetch(url);

  if (!response.ok) {
    // 404 = message not found, 400 = invalid hash format
    // Both cases mean attestation is not available
    if (response.status === 404 || response.status === 400) {
      return {
        status: "pending",
        attestation: null,
        messageHash: normalizedHash,
      };
    }
    throw new Error(`Attestation API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.status === "pending_confirmations" || !data.attestation) {
    return {
      status: "pending",
      attestation: null,
      messageHash: normalizedHash,
    };
  }

  // Attestation is hex-encoded
  const attestationHex = data.attestation.replace("0x", "");
  const attestation = new Uint8Array(Buffer.from(attestationHex, "hex"));

  return {
    status: "complete",
    attestation,
    messageHash: normalizedHash,
  };
}

/**
 * Fetch attestation using V2 API endpoint
 */
export async function getAttestationV2(
  txHash: string,
  isMainnet: boolean = false
): Promise<AttestationResult & { messages?: any[] }> {
  const baseUrl = isMainnet ? IRIS_API.MAINNET : IRIS_API.TESTNET;
  const url = `${baseUrl}/v2/messages?transactionHash=${txHash}`;

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      return {
        status: "pending",
        attestation: null,
        messageHash: txHash,
      };
    }
    throw new Error(`Attestation API V2 error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.messages || data.messages.length === 0) {
    return {
      status: "pending",
      attestation: null,
      messageHash: txHash,
    };
  }

  const message = data.messages[0];
  if (message.status !== "complete" || !message.attestation) {
    return {
      status: "pending",
      attestation: null,
      messageHash: message.messageHash || txHash,
      messages: data.messages,
    };
  }

  const attestationHex = message.attestation.replace("0x", "");
  const attestation = new Uint8Array(Buffer.from(attestationHex, "hex"));

  return {
    status: "complete",
    attestation,
    messageHash: message.messageHash,
    messages: data.messages,
  };
}

/**
 * Poll for attestation until it's ready
 *
 * @param messageHash - Message hash from depositForBurn
 * @param isMainnet - Use mainnet or testnet
 * @param maxAttempts - Maximum polling attempts (default: 60)
 * @param intervalMs - Polling interval in ms (default: 30000 = 30s)
 * @returns Completed attestation
 */
export async function waitForAttestation(
  messageHash: string,
  isMainnet: boolean = false,
  maxAttempts: number = 60,
  intervalMs: number = 30000
): Promise<AttestationResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await getAttestation(messageHash, isMainnet);

    if (result.status === "complete" && result.attestation) {
      return result;
    }

    console.log(
      `Attestation pending (attempt ${attempt + 1}/${maxAttempts}), waiting...`
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Attestation not ready after ${maxAttempts} attempts (${(maxAttempts * intervalMs) / 60000} minutes)`
  );
}

/**
 * Receive USDC on Solana from another chain
 *
 * This mints USDC on Solana after it was burned on the source chain.
 * Requires the original message and signed attestation from Iris.
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer
 * @param recipient - USDC recipient public key
 * @param params - Receive parameters
 * @param config - Bridge configuration
 * @returns Receive result
 */
export async function receiveUsdcOnSolana(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  params: ReceiveMessageParams,
  config: BridgeConfig
): Promise<ReceiveMessageResult> {
  const useV2 = config.useV2 !== false;
  const mint = config.isMainnet ? USDC_MINT.MAINNET : USDC_MINT.DEVNET;
  const programs = getPrograms(useV2);

  // Parse message to get source domain and nonce
  const parsedMessage = parseMessage(params.message);
  const burnMessage = parseBurnMessage(parsedMessage.messageBody);

  // Derive required PDAs
  const [messageTransmitter] = findMessageTransmitterPda(useV2);
  const [tokenMessenger] = findTokenMessengerPda(useV2);
  const [tokenMinter] = findTokenMinterPda(useV2);
  const [localToken] = findLocalTokenPda(mint, useV2);
  const [remoteTokenMessenger] = findRemoteTokenMessengerPda(
    parsedMessage.sourceDomain,
    useV2
  );
  const [custodyTokenAccount] = findCustodyTokenAccountPda(mint, useV2);
  const [tokenPair] = findTokenPairPda(
    parsedMessage.sourceDomain,
    burnMessage.burnToken,
    useV2
  );

  // Derive used nonces PDA
  const [usedNonces] = useV2
    ? findUsedNoncesPdaV2(parsedMessage.sourceDomain, parsedMessage.nonce)
    : findUsedNoncesPdaV1(parsedMessage.sourceDomain, parsedMessage.nonce);

  // Derive authority PDA
  const [authorityPda] = findAuthorityPda(programs.tokenMessengerMinter, useV2);

  // Get or create recipient's USDC token account
  const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);

  // Check if token account exists, create if not
  const tokenAccountInfo = await connection.getAccountInfo(recipientTokenAccount);
  const preInstructions: TransactionInstruction[] = [];

  if (!tokenAccountInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        recipientTokenAccount,
        recipient,
        mint
      )
    );
  }

  // Build receiveMessage instruction data
  const instructionData = buildReceiveMessageInstructionData(
    params.message,
    params.attestation
  );

  // Build the instruction
  const receiveMessageIx = new TransactionInstruction({
    programId: programs.messageTransmitter,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: payer.publicKey, isSigner: true, isWritable: false }, // caller
      { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
      { pubkey: messageTransmitter, isSigner: false, isWritable: true }, // message_transmitter
      { pubkey: usedNonces, isSigner: false, isWritable: true }, // used_nonces
      {
        pubkey: programs.tokenMessengerMinter,
        isSigner: false,
        isWritable: false,
      }, // receiver
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      // Remaining accounts for token messenger minter (CPI)
      { pubkey: tokenMessenger, isSigner: false, isWritable: false }, // token_messenger
      { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false }, // remote_token_messenger
      { pubkey: tokenMinter, isSigner: false, isWritable: true }, // token_minter
      { pubkey: localToken, isSigner: false, isWritable: true }, // local_token
      { pubkey: tokenPair, isSigner: false, isWritable: false }, // token_pair
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true }, // recipient_token_account
      { pubkey: custodyTokenAccount, isSigner: false, isWritable: true }, // custody_token_account
      { pubkey: mint, isSigner: false, isWritable: true }, // token_mint
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    ],
    data: instructionData,
  });

  // Add compute budget for complex transaction
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 400_000,
  });

  // Build and send transaction
  const transaction = new Transaction();
  transaction.add(computeBudgetIx);
  preInstructions.forEach((ix) => transaction.add(ix));
  transaction.add(receiveMessageIx);

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    payer,
  ]);

  return {
    signature,
    amount: burnMessage.amount,
    recipientTokenAccount,
  };
}

/**
 * Reclaim rent from a consumed MessageSent event account
 *
 * After a message has been processed (received on destination chain),
 * the event account can be closed to reclaim the rent deposit.
 * There is a 5-day waiting period before reclaim is allowed.
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer (must be original rent payer)
 * @param params - Reclaim parameters
 * @param config - Bridge configuration
 * @returns Reclaim result
 */
export async function reclaimEventAccount(
  connection: Connection,
  payer: Keypair,
  params: ReclaimEventAccountParams,
  config: BridgeConfig
): Promise<ReclaimEventAccountResult> {
  const useV2 = config.useV2 !== false;
  const programs = getPrograms(useV2);

  // Derive message transmitter PDA
  const [messageTransmitter] = findMessageTransmitterPda(useV2);

  // Get account balance before reclaim
  const accountInfoBefore = await connection.getAccountInfo(
    params.messageSentEventAccount
  );
  const lamportsBefore = accountInfoBefore?.lamports || 0;

  // Build instruction data
  const instructionData = buildReclaimEventAccountInstructionData(
    params.attestation,
    params.destinationMessage
  );

  // Build the instruction
  const reclaimIx = new TransactionInstruction({
    programId: programs.messageTransmitter,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payee (rent receiver)
      { pubkey: messageTransmitter, isSigner: false, isWritable: false }, // message_transmitter
      {
        pubkey: params.messageSentEventAccount,
        isSigner: false,
        isWritable: true,
      }, // message_sent_event_data
    ],
    data: instructionData,
  });

  // Build and send transaction
  const transaction = new Transaction().add(reclaimIx);

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    payer,
  ]);

  return {
    signature,
    lamportsReclaimed: BigInt(lamportsBefore),
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert an EVM address (20 bytes) to CCTP format (32 bytes, left-padded)
 */
export function evmAddressToCctp(evmAddress: string): Uint8Array {
  const addressBytes = Buffer.from(evmAddress.replace("0x", ""), "hex");
  if (addressBytes.length !== 20) {
    throw new Error("Invalid EVM address length");
  }
  const padded = Buffer.alloc(32);
  addressBytes.copy(padded, 12); // Left-pad with zeros (address in last 20 bytes)
  return new Uint8Array(padded);
}

/**
 * Convert a Solana public key to CCTP format (already 32 bytes)
 */
export function solanaAddressToCctp(publicKey: PublicKey): Uint8Array {
  return publicKey.toBytes();
}

/**
 * Convert CCTP format address back to EVM address string
 */
export function cctpToEvmAddress(cctpAddress: Uint8Array): string {
  if (cctpAddress.length !== 32) {
    throw new Error("Invalid CCTP address length");
  }
  // EVM address is in last 20 bytes
  const addressBytes = Buffer.from(cctpAddress.slice(12));
  return "0x" + addressBytes.toString("hex");
}

/**
 * Convert CCTP format address back to Solana PublicKey
 */
export function cctpToSolanaAddress(cctpAddress: Uint8Array): PublicKey {
  if (cctpAddress.length !== 32) {
    throw new Error("Invalid CCTP address length");
  }
  return new PublicKey(cctpAddress);
}

/**
 * Get chain name from domain ID
 */
export function getChainName(domain: CctpDomain): string {
  return CHAIN_INFO[domain]?.name || `Unknown (${domain})`;
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerUrl(domain: CctpDomain, txHash: string): string {
  const info = CHAIN_INFO[domain];
  if (!info) return "";

  if (domain === CCTP_DOMAINS.SOLANA) {
    return `${info.explorer}/tx/${txHash}`;
  }
  return `${info.explorer}/tx/${txHash}`;
}

/**
 * Estimate bridge time based on source chain
 * Returns estimated time in minutes for attestation
 */
export function estimateBridgeTime(sourceDomain: CctpDomain): {
  minMinutes: number;
  maxMinutes: number;
  description: string;
} {
  // Attestation time depends on source chain finality
  const estimates: Record<
    CctpDomain,
    { min: number; max: number; desc: string }
  > = {
    [CCTP_DOMAINS.ETHEREUM]: {
      min: 15,
      max: 20,
      desc: "~15-20 min (13 confirmations)",
    },
    [CCTP_DOMAINS.SOLANA]: { min: 1, max: 3, desc: "~1-3 min (32 slots)" },
    [CCTP_DOMAINS.BASE]: {
      min: 15,
      max: 20,
      desc: "~15-20 min (L2 finality)",
    },
    [CCTP_DOMAINS.ARBITRUM]: {
      min: 15,
      max: 20,
      desc: "~15-20 min (L2 finality)",
    },
    [CCTP_DOMAINS.OPTIMISM]: {
      min: 15,
      max: 20,
      desc: "~15-20 min (L2 finality)",
    },
    [CCTP_DOMAINS.POLYGON]: {
      min: 5,
      max: 10,
      desc: "~5-10 min (128 confirmations)",
    },
    [CCTP_DOMAINS.AVALANCHE]: {
      min: 1,
      max: 3,
      desc: "~1-3 min (fast finality)",
    },
    [CCTP_DOMAINS.NOBLE]: { min: 1, max: 2, desc: "~1-2 min (IBC)" },
    [CCTP_DOMAINS.SUI]: { min: 1, max: 2, desc: "~1-2 min (fast finality)" },
  };

  const estimate = estimates[sourceDomain] || {
    min: 15,
    max: 30,
    desc: "Unknown",
  };
  return {
    minMinutes: estimate.min,
    maxMinutes: estimate.max,
    description: estimate.desc,
  };
}

/**
 * Calculate approximate gas/fee for bridging
 */
export function estimateBridgeCost(destinationDomain: CctpDomain): {
  estimatedUsd: string;
  description: string;
} {
  // Rough estimates - actual costs vary with gas prices
  const costs: Record<CctpDomain, { usd: string; desc: string }> = {
    [CCTP_DOMAINS.ETHEREUM]: {
      usd: "$5-15",
      desc: "ETH gas varies significantly",
    },
    [CCTP_DOMAINS.SOLANA]: {
      usd: "$0.01",
      desc: "Very low Solana fees",
    },
    [CCTP_DOMAINS.BASE]: { usd: "$0.10-0.50", desc: "Low L2 fees" },
    [CCTP_DOMAINS.ARBITRUM]: { usd: "$0.10-0.50", desc: "Low L2 fees" },
    [CCTP_DOMAINS.OPTIMISM]: { usd: "$0.10-0.50", desc: "Low L2 fees" },
    [CCTP_DOMAINS.POLYGON]: { usd: "$0.05-0.20", desc: "Low Polygon fees" },
    [CCTP_DOMAINS.AVALANCHE]: { usd: "$0.10-0.30", desc: "Moderate fees" },
    [CCTP_DOMAINS.NOBLE]: { usd: "$0.01", desc: "Low Cosmos fees" },
    [CCTP_DOMAINS.SUI]: { usd: "$0.01", desc: "Low Sui fees" },
  };

  const cost = costs[destinationDomain] || { usd: "Unknown", desc: "" };
  return {
    estimatedUsd: cost.usd,
    description: cost.desc,
  };
}

/**
 * Validate CCTP message integrity
 */
export function validateMessage(message: Uint8Array): {
  valid: boolean;
  error?: string;
} {
  try {
    const parsed = parseMessage(message);

    // Check destination domain is valid
    if (
      !Object.values(CCTP_DOMAINS).includes(
        parsed.destinationDomain as CctpDomain
      )
    ) {
      return { valid: false, error: "Invalid destination domain" };
    }

    // Check source domain is valid
    if (
      !Object.values(CCTP_DOMAINS).includes(parsed.sourceDomain as CctpDomain)
    ) {
      return { valid: false, error: "Invalid source domain" };
    }

    // Check message body is not empty
    if (parsed.messageBody.length === 0) {
      return { valid: false, error: "Empty message body" };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// =============================================================================
// High-Level API
// =============================================================================

/**
 * Complete bridge flow: burn on Solana, wait for attestation, receive on destination
 * Note: Receiving on non-Solana chains requires additional chain-specific implementation
 *
 * @param connection - Solana connection
 * @param payer - Payer keypair
 * @param amount - Amount to bridge (USDC, 6 decimals)
 * @param destinationDomain - Target chain
 * @param mintRecipient - Recipient address (32 bytes)
 * @param config - Bridge configuration
 * @returns Bridge result with signatures
 */
export async function bridgeUsdcComplete(
  connection: Connection,
  payer: Keypair,
  amount: bigint,
  destinationDomain: CctpDomain,
  mintRecipient: Uint8Array,
  config: BridgeConfig
): Promise<{
  depositSignature: string;
  messageHash: string;
  message: Uint8Array;
  messageSentEventAccount: PublicKey;
  attestation: Uint8Array;
  estimatedArrival: string;
}> {
  console.log(`\nInitiating USDC bridge: ${Number(amount) / 1_000_000} USDC`);
  console.log(`From: Solana`);
  console.log(`To: ${getChainName(destinationDomain)}`);

  // Step 1: Burn USDC on Solana
  console.log("\n[1/3] Burning USDC on Solana...");
  const depositResult = await bridgeUsdcFromSolana(
    connection,
    payer,
    {
      amount,
      destinationDomain,
      mintRecipient,
    },
    config
  );
  console.log(`Burn transaction: ${depositResult.signature}`);
  console.log(`Message hash: ${depositResult.messageHash}`);

  // Step 2: Wait for attestation
  console.log("\n[2/3] Waiting for Circle attestation...");
  const timeEstimate = estimateBridgeTime(CCTP_DOMAINS.SOLANA);
  console.log(`Estimated wait: ${timeEstimate.description}`);

  const attestationResult = await waitForAttestation(
    depositResult.messageHash,
    config.isMainnet
  );
  console.log("Attestation received!");

  // Step 3: For non-Solana destinations, user needs to claim on destination chain
  console.log("\n[3/3] Attestation ready for claiming on destination chain");

  return {
    depositSignature: depositResult.signature,
    messageHash: depositResult.messageHash,
    message: depositResult.message,
    messageSentEventAccount: depositResult.messageSentEventAccount,
    attestation: attestationResult.attestation!,
    estimatedArrival: `${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} minutes from now`,
  };
}

/**
 * Check USDC balance on Solana
 */
export async function getUsdcBalance(
  connection: Connection,
  owner: PublicKey,
  isMainnet: boolean = false
): Promise<bigint> {
  const mint = isMainnet ? USDC_MINT.MAINNET : USDC_MINT.DEVNET;
  const tokenAccount = await getAssociatedTokenAddress(mint, owner);

  try {
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return BigInt(balance.value.amount);
  } catch {
    return BigInt(0);
  }
}

/**
 * Get all PDAs needed for CCTP operations
 */
export function getAllPdas(
  mint: PublicKey,
  destinationDomain: CctpDomain,
  useV2: boolean = true
): {
  messageTransmitter: PublicKey;
  tokenMessenger: PublicKey;
  tokenMinter: PublicKey;
  localToken: PublicKey;
  remoteTokenMessenger: PublicKey;
  senderAuthority: PublicKey;
  custodyTokenAccount: PublicKey;
} {
  const [messageTransmitter] = findMessageTransmitterPda(useV2);
  const [tokenMessenger] = findTokenMessengerPda(useV2);
  const [tokenMinter] = findTokenMinterPda(useV2);
  const [localToken] = findLocalTokenPda(mint, useV2);
  const [remoteTokenMessenger] = findRemoteTokenMessengerPda(
    destinationDomain,
    useV2
  );
  const [senderAuthority] = findSenderAuthorityPda(useV2);
  const [custodyTokenAccount] = findCustodyTokenAccountPda(mint, useV2);

  return {
    messageTransmitter,
    tokenMessenger,
    tokenMinter,
    localToken,
    remoteTokenMessenger,
    senderAuthority,
    custodyTokenAccount,
  };
}

// =============================================================================
// Dry-Run / Simulation Helpers
// =============================================================================

/**
 * Build depositForBurn instruction without sending (for dry-run testing)
 */
export function buildDepositForBurnInstruction(
  payer: PublicKey,
  mint: PublicKey,
  params: DepositForBurnV2Params,
  useV2: boolean = true
): {
  instruction: TransactionInstruction;
  messageSentEventAccount: Keypair;
  accounts: Record<string, PublicKey>;
} {
  const programs = getPrograms(useV2);

  // Derive required PDAs
  const [messageTransmitter] = findMessageTransmitterPda(useV2);
  const [tokenMessenger] = findTokenMessengerPda(useV2);
  const [tokenMinter] = findTokenMinterPda(useV2);
  const [localToken] = findLocalTokenPda(mint, useV2);
  const [remoteTokenMessenger] = findRemoteTokenMessengerPda(
    params.destinationDomain,
    useV2
  );
  const [senderAuthority] = findSenderAuthorityPda(useV2);
  const [denylistAccount] = findDenylistPda(payer, useV2);

  // Create event account keypair
  const messageSentEventAccount = Keypair.generate();

  // Build instruction data
  const hasDestinationCaller =
    params.destinationCaller &&
    !Buffer.from(params.destinationCaller).equals(Buffer.alloc(32));

  const instructionData = hasDestinationCaller
    ? buildDepositForBurnWithCallerInstructionData(params)
    : buildDepositForBurnInstructionData(params);

  // Get payer's token account (assumes ATA)
  const payerTokenAccount = PublicKey.findProgramAddressSync(
    [payer.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  )[0];

  const instruction = new TransactionInstruction({
    programId: programs.tokenMessengerMinter,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: senderAuthority, isSigner: false, isWritable: false },
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: denylistAccount, isSigner: false, isWritable: false },
      { pubkey: messageTransmitter, isSigner: false, isWritable: true },
      { pubkey: tokenMessenger, isSigner: false, isWritable: false },
      { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false },
      { pubkey: tokenMinter, isSigner: false, isWritable: false },
      { pubkey: localToken, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      {
        pubkey: messageSentEventAccount.publicKey,
        isSigner: true,
        isWritable: true,
      },
      { pubkey: programs.messageTransmitter, isSigner: false, isWritable: false },
      { pubkey: programs.tokenMessengerMinter, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  return {
    instruction,
    messageSentEventAccount,
    accounts: {
      payer,
      payerTokenAccount,
      senderAuthority,
      denylistAccount,
      messageTransmitter,
      tokenMessenger,
      remoteTokenMessenger,
      tokenMinter,
      localToken,
      mint,
      messageSentEventAccount: messageSentEventAccount.publicKey,
      messageTransmitterProgram: programs.messageTransmitter,
      tokenMessengerMinterProgram: programs.tokenMessengerMinter,
    },
  };
}

/**
 * Serialize instruction data for verification
 */
export function serializeInstructionData(
  instructionName: string,
  params: Record<string, unknown>
): Buffer {
  switch (instructionName) {
    case "depositForBurn":
      return buildDepositForBurnInstructionData(
        params as unknown as DepositForBurnV2Params
      );
    case "depositForBurnWithCaller":
      return buildDepositForBurnWithCallerInstructionData(
        params as unknown as DepositForBurnV2Params
      );
    case "receiveMessage":
      return buildReceiveMessageInstructionData(
        params.message as Uint8Array,
        params.attestation as Uint8Array
      );
    case "reclaimEventAccount":
      return buildReclaimEventAccountInstructionData(
        params.attestation as Uint8Array,
        params.destinationMessage as Uint8Array
      );
    default:
      throw new Error(`Unknown instruction: ${instructionName}`);
  }
}
