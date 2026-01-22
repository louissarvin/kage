/**
 * ShadowVest Stealth Payment Scanner
 *
 * Service for employees to discover stealth payments made to them.
 * Scans StealthPaymentEvent logs and checks if each payment belongs
 * to the employee using their view private key.
 */

import { Connection, PublicKey, ConfirmedSignatureInfo, ParsedTransactionWithMeta } from '@solana/web3.js';
import { BorshCoder, EventParser, Program, Idl } from '@coral-xyz/anchor';
import * as bs58 from 'bs58';
import {
  isMyStealthPayment,
  deriveStealthKeypair,
  decryptEphemeralPrivKey,
  decryptNote,
  StealthSigner,
} from './stealth-address';

// Type definitions matching the on-chain StealthPaymentEvent
export interface StealthPaymentEvent {
  organization: PublicKey;
  stealthAddress: PublicKey;
  ephemeralPubkey: Uint8Array;
  encryptedPayload: Uint8Array;
  positionId: bigint;
  tokenMint: PublicKey;
  timestamp: bigint;
}

// Discovered payment with decryption capabilities
export interface DiscoveredPayment {
  event: StealthPaymentEvent;
  signature: string;
  slot: number;
  blockTime: number | null;
  // Methods to decrypt and access funds
  getSigner: () => Promise<StealthSigner>;
  decryptNote: () => Promise<string>;
}

// Scanner configuration
export interface ScannerConfig {
  connection: Connection;
  programId: PublicKey;
  // Employee's meta-keys (private keys for scanning)
  viewPrivateKeyHex: string;
  spendPrivateKeyHex: string;
  // Optional: IDL for event parsing (if using Anchor events)
  idl?: Idl;
}

// Scan options
export interface ScanOptions {
  // Starting signature to scan from (for pagination)
  beforeSignature?: string;
  // Number of signatures to fetch per batch
  limit?: number;
  // Only scan after this timestamp (unix seconds)
  afterTimestamp?: number;
  // Filter by organization
  organization?: PublicKey;
}

/**
 * StealthScanner - Main class for scanning stealth payments
 *
 * Usage:
 * ```typescript
 * const scanner = new StealthScanner({
 *   connection,
 *   programId,
 *   viewPrivateKeyHex: '...',
 *   spendPrivateKeyHex: '...',
 * });
 *
 * // Scan for payments
 * const payments = await scanner.scan();
 * for (const payment of payments) {
 *   console.log('Found payment:', payment.event.positionId);
 *   const signer = await payment.getSigner();
 *   // Use signer to claim vested tokens
 * }
 * ```
 */
export class StealthScanner {
  private connection: Connection;
  private programId: PublicKey;
  private viewPrivateKeyHex: string;
  private spendPrivateKeyHex: string;
  private spendPublicKey58: string;
  private eventParser?: EventParser;

  constructor(config: ScannerConfig) {
    this.connection = config.connection;
    this.programId = config.programId;
    this.viewPrivateKeyHex = config.viewPrivateKeyHex;
    this.spendPrivateKeyHex = config.spendPrivateKeyHex;

    // Derive spend public key from private key for verification
    // Note: This requires the actual key derivation - placeholder for now
    this.spendPublicKey58 = ''; // Will be set during initialization

    if (config.idl) {
      const coder = new BorshCoder(config.idl);
      this.eventParser = new EventParser(config.programId, coder);
    }
  }

  /**
   * Initialize the scanner by deriving public keys
   */
  async initialize(): Promise<void> {
    // Derive spend public key from spend private key
    // The spend private key is the scalar, we need to compute S = s * G
    const { ed25519 } = await import('@noble/curves/ed25519');

    // Convert hex to bytes
    const spendPrivBytes = Buffer.from(this.spendPrivateKeyHex, 'hex');

    // Get the scalar from the private key (first 32 bytes, clamped)
    const scalar = ed25519.utils.getExtendedPublicKey(spendPrivBytes).scalar;

    // Compute public key point
    const spendPubPoint = ed25519.ExtendedPoint.BASE.multiply(scalar);
    const spendPubBytes = spendPubPoint.toRawBytes();

    this.spendPublicKey58 = bs58.encode(spendPubBytes);
  }

  /**
   * Scan for stealth payments belonging to this employee
   */
  async scan(options: ScanOptions = {}): Promise<DiscoveredPayment[]> {
    const { beforeSignature, limit = 1000, afterTimestamp, organization } = options;

    // Get recent transaction signatures for the program
    const signatures = await this.getTransactionSignatures(beforeSignature, limit);

    // Parse transactions and extract stealth payment events
    const events = await this.extractStealthPaymentEvents(signatures);

    // Filter events that belong to this employee
    const myPayments: DiscoveredPayment[] = [];

    for (const { event, signature, slot, blockTime } of events) {
      // Apply filters
      if (afterTimestamp && blockTime && blockTime < afterTimestamp) {
        continue;
      }

      if (organization && !event.organization.equals(organization)) {
        continue;
      }

      // Check if this payment is for us
      const ephPub58 = bs58.encode(event.ephemeralPubkey);
      const isMine = await isMyStealthPayment(
        this.viewPrivateKeyHex,
        this.spendPublicKey58,
        ephPub58,
        event.stealthAddress
      );

      if (isMine) {
        myPayments.push(this.createDiscoveredPayment(event, signature, slot, blockTime));
      }
    }

    return myPayments;
  }

  /**
   * Scan continuously for new payments
   */
  async *scanContinuous(
    pollIntervalMs: number = 10000
  ): AsyncGenerator<DiscoveredPayment, void, unknown> {
    let lastSignature: string | undefined;
    const seenSignatures = new Set<string>();

    while (true) {
      const payments = await this.scan({
        beforeSignature: lastSignature,
        limit: 100,
      });

      for (const payment of payments) {
        if (!seenSignatures.has(payment.signature)) {
          seenSignatures.add(payment.signature);
          yield payment;
        }
      }

      // Update cursor for next iteration
      if (payments.length > 0) {
        // Note: we'd need to track the oldest signature to continue scanning back
        // For real-time scanning, we start fresh each time
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Get transaction signatures for the program
   */
  private async getTransactionSignatures(
    before?: string,
    limit: number = 1000
  ): Promise<ConfirmedSignatureInfo[]> {
    const signatures = await this.connection.getSignaturesForAddress(this.programId, {
      before,
      limit,
    });

    return signatures;
  }

  /**
   * Extract stealth payment events from transactions
   */
  private async extractStealthPaymentEvents(
    signatures: ConfirmedSignatureInfo[]
  ): Promise<
    Array<{
      event: StealthPaymentEvent;
      signature: string;
      slot: number;
      blockTime: number | null;
    }>
  > {
    const results: Array<{
      event: StealthPaymentEvent;
      signature: string;
      slot: number;
      blockTime: number | null;
    }> = [];

    // Batch fetch transactions for efficiency
    const batchSize = 100;
    for (let i = 0; i < signatures.length; i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);
      const transactions = await this.connection.getParsedTransactions(
        batch.map((s) => s.signature),
        { maxSupportedTransactionVersion: 0 }
      );

      for (let j = 0; j < transactions.length; j++) {
        const tx = transactions[j];
        if (!tx) continue;

        const sigInfo = batch[j];
        const events = this.parseEventsFromTransaction(tx);

        for (const event of events) {
          results.push({
            event,
            signature: sigInfo.signature,
            slot: sigInfo.slot,
            blockTime: sigInfo.blockTime,
          });
        }
      }
    }

    return results;
  }

  /**
   * Parse stealth payment events from a transaction
   */
  private parseEventsFromTransaction(tx: ParsedTransactionWithMeta): StealthPaymentEvent[] {
    const events: StealthPaymentEvent[] = [];

    // If we have an event parser, use it
    if (this.eventParser && tx.meta?.logMessages) {
      const parsedEvents = this.eventParser.parseLogs(tx.meta.logMessages);
      for (const event of parsedEvents) {
        if (event.name === 'StealthPaymentEvent') {
          events.push(this.convertParsedEvent(event.data));
        }
      }
    } else {
      // Manual parsing from log messages
      // Anchor events are logged as base64-encoded data with "Program data:" prefix
      const logs = tx.meta?.logMessages || [];

      for (const log of logs) {
        if (log.includes('Program data:')) {
          try {
            const dataStr = log.split('Program data: ')[1];
            if (dataStr) {
              const decoded = Buffer.from(dataStr, 'base64');
              const event = this.decodeStealthPaymentEvent(decoded);
              if (event) {
                events.push(event);
              }
            }
          } catch {
            // Not a valid event, skip
          }
        }
      }
    }

    return events;
  }

  /**
   * Decode a raw stealth payment event from bytes
   */
  private decodeStealthPaymentEvent(data: Buffer): StealthPaymentEvent | null {
    try {
      // Anchor event discriminator (8 bytes) followed by event data
      // Discriminator for "StealthPaymentEvent" - compute sha256("event:StealthPaymentEvent")[0..8]
      const DISCRIMINATOR = Buffer.from([
        /* computed discriminator bytes */
      ]);

      // Check discriminator (first 8 bytes)
      // Note: In production, compute the actual discriminator
      if (data.length < 8 + 32 + 32 + 32 + 128 + 8 + 32 + 8) {
        return null;
      }

      let offset = 8; // Skip discriminator

      // organization: Pubkey (32 bytes)
      const organization = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;

      // stealth_address: Pubkey (32 bytes)
      const stealthAddress = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;

      // ephemeral_pubkey: [u8; 32]
      const ephemeralPubkey = new Uint8Array(data.subarray(offset, offset + 32));
      offset += 32;

      // encrypted_payload: [u8; 128]
      const encryptedPayload = new Uint8Array(data.subarray(offset, offset + 128));
      offset += 128;

      // position_id: u64
      const positionId = data.readBigUInt64LE(offset);
      offset += 8;

      // token_mint: Pubkey (32 bytes)
      const tokenMint = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;

      // timestamp: i64
      const timestamp = data.readBigInt64LE(offset);

      return {
        organization,
        stealthAddress,
        ephemeralPubkey,
        encryptedPayload,
        positionId,
        tokenMint,
        timestamp,
      };
    } catch {
      return null;
    }
  }

  /**
   * Convert parsed Anchor event to our type
   */
  private convertParsedEvent(data: unknown): StealthPaymentEvent {
    const d = data as {
      organization: PublicKey;
      stealthAddress: PublicKey;
      ephemeralPubkey: number[];
      encryptedPayload: number[];
      positionId: { toNumber?: () => number } | number;
      tokenMint: PublicKey;
      timestamp: { toNumber?: () => number } | number;
    };

    return {
      organization: d.organization,
      stealthAddress: d.stealthAddress,
      ephemeralPubkey: new Uint8Array(d.ephemeralPubkey),
      encryptedPayload: new Uint8Array(d.encryptedPayload),
      positionId: BigInt(typeof d.positionId === 'object' && d.positionId.toNumber ? d.positionId.toNumber() : d.positionId),
      tokenMint: d.tokenMint,
      timestamp: BigInt(typeof d.timestamp === 'object' && d.timestamp.toNumber ? d.timestamp.toNumber() : d.timestamp),
    };
  }

  /**
   * Create a discovered payment object with helper methods
   */
  private createDiscoveredPayment(
    event: StealthPaymentEvent,
    signature: string,
    slot: number,
    blockTime: number | null
  ): DiscoveredPayment {
    const viewPrivHex = this.viewPrivateKeyHex;
    const spendPrivHex = this.spendPrivateKeyHex;

    return {
      event,
      signature,
      slot,
      blockTime,

      getSigner: async (): Promise<StealthSigner> => {
        // First decrypt the ephemeral private key from the payload
        const ephPub58 = bs58.encode(event.ephemeralPubkey);
        const encryptedPayloadB64 = Buffer.from(event.encryptedPayload).toString('base64');

        const ephPriv32 = await decryptEphemeralPrivKey(encryptedPayloadB64, viewPrivHex, ephPub58);

        // Derive the stealth keypair
        const viewPub58 = ''; // Would need to be computed from viewPrivHex
        return deriveStealthKeypair(spendPrivHex, viewPub58, ephPriv32);
      },

      decryptNote: async (): Promise<string> => {
        const ephPub58 = bs58.encode(event.ephemeralPubkey);
        const encryptedPayloadB64 = Buffer.from(event.encryptedPayload).toString('base64');
        return decryptNote(encryptedPayloadB64, viewPrivHex, ephPub58);
      },
    };
  }
}

/**
 * Helper function to create and initialize a scanner
 */
export async function createStealthScanner(config: ScannerConfig): Promise<StealthScanner> {
  const scanner = new StealthScanner(config);
  await scanner.initialize();
  return scanner;
}

/**
 * Simple scan function for one-time use
 */
export async function scanForStealthPayments(
  connection: Connection,
  programId: PublicKey,
  viewPrivateKeyHex: string,
  spendPrivateKeyHex: string,
  options?: ScanOptions
): Promise<DiscoveredPayment[]> {
  const scanner = await createStealthScanner({
    connection,
    programId,
    viewPrivateKeyHex,
    spendPrivateKeyHex,
  });

  return scanner.scan(options);
}
