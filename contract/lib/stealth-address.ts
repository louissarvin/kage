/**
 * ShadowVest Stealth Address Library
 *
 * ECDH-based stealth addresses for receiver privacy on Solana.
 * Each payment goes to a unique, unlinkable one-time address.
 *
 * Based on EIP-5564 stealth address standard adapted for Ed25519/Solana.
 *
 * Flow:
 * 1. Employee generates (spend_key, view_key) and publishes (S, V)
 * 2. Employer generates ephemeral key (r), computes stealth address
 * 3. Employee scans for payments using view_key, derives spend_key
 *
 * @see https://eips.ethereum.org/EIPS/eip-5564
 * @see https://vitalik.eth.limo/general/2023/01/20/stealth.html
 */

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { ed25519 } from '@noble/curves/ed25519';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'crypto';

// ============================================================================
// Constants
// ============================================================================

/** Ed25519 curve order (L) */
const L = BigInt(
  '0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed',
);

// ============================================================================
// Types
// ============================================================================

/**
 * Employee's stealth meta-address (published once, used for all payments)
 */
export interface StealthMetaAddress {
  /** Spend public key (S = s * G) - used to derive stealth addresses */
  spendPubkey: string; // base58
  /** View public key (V = v * G) - used for ECDH shared secret */
  viewPubkey: string; // base58
}

/**
 * Employee's private meta-keys (kept secret)
 */
export interface StealthMetaKeys {
  /** Spend private key (s) - 32 bytes hex */
  spendPrivKey: string;
  /** View private key (v) - 32 bytes hex */
  viewPrivKey: string;
  /** Public meta-address to share with employers */
  metaAddress: StealthMetaAddress;
}

/**
 * Payment data for creating a stealth payment
 */
export interface StealthPaymentData {
  /** The stealth address to send funds to */
  stealthAddress: PublicKey;
  /** Ephemeral public key (R) - must be included in transaction/event */
  ephemeralPubkey: string; // base58
  /** Encrypted payload containing ephemeral private key (for memo field) */
  encryptedPayload: string; // base58
}

/**
 * Custom signer that works from derived scalar (stealth private key)
 */
export class StealthSigner {
  private scalarBytes: Uint8Array;
  private scalar: bigint;
  public publicKey: PublicKey;

  constructor(scalarBytes: Uint8Array) {
    this.scalarBytes = scalarBytes;
    this.scalar = bytesToNumberLE(scalarBytes);
    this.publicKey = new PublicKey(
      ed25519.ExtendedPoint.BASE.multiply(this.scalar).toRawBytes()
    );
  }

  /**
   * Sign a message with the stealth private key
   */
  async signMessage(message: Uint8Array | string): Promise<Uint8Array> {
    const msg = typeof message === 'string'
      ? Buffer.from(message)
      : new Uint8Array(message);

    // Ed25519 signature generation from scalar
    const prefix = sha512(this.scalarBytes).slice(32);

    const r = mod(bytesToNumberLE(sha512(concatBytes(prefix, msg))), L);
    const R = ed25519.ExtendedPoint.BASE.multiply(r);
    const A = ed25519.ExtendedPoint.BASE.multiply(this.scalar);

    const hramInput = concatBytes(R.toRawBytes(), A.toRawBytes(), msg);
    const h = mod(bytesToNumberLE(sha512(hramInput)), L);
    const s = mod(r + h * this.scalar, L);

    return concatBytes(R.toRawBytes(), bnTo32BytesLE(s));
  }

  /**
   * Sign a Solana transaction
   */
  async signTransaction(tx: { serializeMessage: () => Uint8Array; addSignature: (pubkey: PublicKey, signature: Buffer) => void }): Promise<typeof tx> {
    const message = tx.serializeMessage();
    const signature = await this.signMessage(message);
    tx.addSignature(this.publicKey, Buffer.from(signature));
    return tx;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

const mod = (x: bigint, n: bigint): bigint => ((x % n) + n) % n;

const to32u8 = (raw: Uint8Array | string | Buffer): Uint8Array =>
  raw instanceof Uint8Array
    ? raw
    : typeof raw === 'string' && /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : typeof raw === 'string'
    ? bs58.decode(raw)
    : Buffer.isBuffer(raw)
    ? new Uint8Array(raw)
    : (() => { throw new Error('unsupported key format'); })();

function clamp(sk: Uint8Array): Uint8Array {
  const clamped = new Uint8Array(sk);
  clamped[0] &= 248;
  clamped[31] &= 127;
  clamped[31] |= 64;
  return clamped;
}

function bytesToNumberLE(u8: Uint8Array): bigint {
  let result = BigInt(0);
  for (let i = u8.length - 1; i >= 0; i--) {
    result = (result << BigInt(8)) + BigInt(u8[i]);
  }
  return result;
}

function bnTo32BytesLE(bn: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let temp = bn;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(temp & BigInt(0xff));
    temp >>= BigInt(8);
  }
  return bytes;
}

function scalarFromSeed(seed32: Uint8Array): bigint {
  // Ed25519 secret scalar derivation (RFC 8032 §5.1.5)
  const h = sha512(seed32);
  return bytesToNumberLE(clamp(h.slice(0, 32)));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate stealth meta-keys for an employee
 *
 * @returns Meta-keys containing spend/view private keys and public meta-address
 *
 * @example
 * ```typescript
 * const metaKeys = generateStealthMetaKeys();
 * // Store privately: metaKeys.spendPrivKey, metaKeys.viewPrivKey
 * // Share with employer: metaKeys.metaAddress
 * ```
 */
export function generateStealthMetaKeys(): StealthMetaKeys {
  const metaSpend = Keypair.generate();
  const metaView = Keypair.generate();

  return {
    spendPrivKey: Buffer.from(metaSpend.secretKey.slice(0, 32)).toString('hex'),
    viewPrivKey: Buffer.from(metaView.secretKey.slice(0, 32)).toString('hex'),
    metaAddress: {
      spendPubkey: metaSpend.publicKey.toBase58(),
      viewPubkey: metaView.publicKey.toBase58(),
    },
  };
}

// ============================================================================
// Encryption (Ephemeral Key & Notes)
// ============================================================================

/**
 * Encrypt the ephemeral private key for the recipient
 *
 * Uses ECDH shared secret with view key for encryption.
 *
 * @param ephPriv32 - Ephemeral private key (32 bytes)
 * @param metaViewPub58 - Recipient's view public key (base58)
 * @returns Encrypted payload (base64)
 */
export async function encryptEphemeralPrivKey(
  ephPriv32: Uint8Array,
  metaViewPub58: string
): Promise<string> {
  // 1. shared secret between (ephPriv, metaViewPub)
  const shared = await ed.getSharedSecret(
    ephPriv32,
    new PublicKey(metaViewPub58).toBytes(),
  );
  const keyBytes = sha256(shared); // 32-byte stream key

  // 2. plaintext = ephPriv32 || ephPub
  const ephPub = await ed.getPublicKey(ephPriv32);
  const plain = new Uint8Array([...ephPriv32, ...ephPub]);

  // 3. XOR-encrypt
  const enc = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) {
    enc[i] = plain[i] ^ keyBytes[i % keyBytes.length];
  }

  // 4. prepend 24-byte random nonce (compat with old layout)
  const nonce = randomBytes(24);
  const payload = new Uint8Array([...nonce, ...enc]);

  return Buffer.from(payload).toString('base64');
}

/**
 * Encrypt ephemeral private key and note together
 *
 * Format: [24-byte nonce][encrypted(ephPriv32 + ephPub + noteLen(2 bytes) + note)]
 *
 * @param ephPriv32 - Ephemeral private key (32 bytes)
 * @param note - Optional note string
 * @param metaViewPub58 - Recipient's view public key (base58)
 * @returns Encrypted payload (base64)
 */
async function encryptPayloadWithNote(
  ephPriv32: Uint8Array,
  note: string,
  metaViewPub58: string
): Promise<string> {
  // 1. shared secret between (ephPriv, metaViewPub)
  const shared = await ed.getSharedSecret(
    ephPriv32,
    new PublicKey(metaViewPub58).toBytes(),
  );
  // Extend key for longer payloads using HKDF-like approach
  const keyBytes1 = sha256(shared);
  const keyBytes2 = sha256(concatBytes(keyBytes1, new Uint8Array([1])));
  const keyBytes3 = sha256(concatBytes(keyBytes1, new Uint8Array([2])));
  const extendedKey = concatBytes(keyBytes1, keyBytes2, keyBytes3); // 96 bytes

  // 2. plaintext = ephPriv32 || ephPub || noteLen (2 bytes) || noteBytes
  const ephPub = await ed.getPublicKey(ephPriv32);
  const noteBytes = new TextEncoder().encode(note);
  const noteLen = new Uint8Array(2);
  noteLen[0] = noteBytes.length & 0xff;
  noteLen[1] = (noteBytes.length >> 8) & 0xff;
  const plain = concatBytes(ephPriv32, ephPub, noteLen, noteBytes);

  // 3. XOR-encrypt with extended key
  const enc = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) {
    enc[i] = plain[i] ^ extendedKey[i % extendedKey.length];
  }

  // 4. prepend 24-byte random nonce
  const nonce = randomBytes(24);
  const payload = concatBytes(nonce, enc);

  return Buffer.from(payload).toString('base64');
}

/**
 * Decrypt the ephemeral private key (receiver side)
 *
 * @param encodedPayload - Encrypted payload (base64)
 * @param metaViewPrivHex - Recipient's view private key (hex)
 * @param ephPub58 - Ephemeral public key from event (base58)
 * @returns Decrypted ephemeral private key (32 bytes)
 */
export async function decryptEphemeralPrivKey(
  encodedPayload: string,
  metaViewPrivHex: string,
  ephPub58: string
): Promise<Uint8Array> {
  const payload = Buffer.from(encodedPayload, 'base64');
  const encrypted = payload.slice(24); // Skip nonce

  // shared secret between (metaViewPriv, ephPub)
  const shared = await ed.getSharedSecret(
    to32u8(metaViewPrivHex),
    to32u8(ephPub58),
  );
  // Extended key (same as encryption)
  const keyBytes1 = sha256(shared);
  const keyBytes2 = sha256(concatBytes(keyBytes1, new Uint8Array([1])));
  const keyBytes3 = sha256(concatBytes(keyBytes1, new Uint8Array([2])));
  const extendedKey = concatBytes(keyBytes1, keyBytes2, keyBytes3);

  const decrypted = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ extendedKey[i % extendedKey.length];
  }

  const ephPriv32 = decrypted.slice(0, 32);
  const receivedEphPub = decrypted.slice(32, 64);
  const computedPub = await ed.getPublicKey(ephPriv32);

  if (!computedPub.every((b, i) => b === receivedEphPub[i])) {
    throw new Error('Decryption failed: ephPub mismatch');
  }

  return ephPriv32;
}

/**
 * Encrypt a private note for the recipient
 *
 * @param plaintext - Message to encrypt (UTF-8)
 * @param ephPriv32 - Ephemeral private key (32 bytes)
 * @param metaViewPub58 - Recipient's view public key (base58)
 * @returns Encrypted note (base58)
 */
export async function encryptNote(
  plaintext: string,
  ephPriv32: Uint8Array,
  metaViewPub58: string
): Promise<string> {
  const shared = await ed.getSharedSecret(
    ephPriv32,
    new PublicKey(metaViewPub58).toBytes(),
  );
  const keyBytes = sha256(shared);

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const enc = new Uint8Array(plaintextBytes.length);
  for (let i = 0; i < plaintextBytes.length; i++) {
    enc[i] = plaintextBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  const nonce = randomBytes(24);
  const payload = new Uint8Array([...nonce, ...enc]);
  return bs58.encode(payload);
}

/**
 * Decrypt a private note from the encrypted payload (receiver side)
 *
 * The payload format is: [24-byte nonce][encrypted(ephPriv32 + ephPub + noteLen(2) + note)]
 *
 * @param encodedPayload - Encrypted payload (base64)
 * @param metaViewPrivHex - Recipient's view private key (hex)
 * @param ephPub58 - Ephemeral public key from event (base58)
 * @returns Decrypted message (UTF-8)
 */
export async function decryptNote(
  encodedPayload: string,
  metaViewPrivHex: string,
  ephPub58: string
): Promise<string> {
  const payload = Buffer.from(encodedPayload, 'base64');
  const encrypted = payload.slice(24); // Skip nonce

  const shared = await ed.getSharedSecret(
    to32u8(metaViewPrivHex),
    to32u8(ephPub58),
  );
  // Extended key (same as encryption)
  const keyBytes1 = sha256(shared);
  const keyBytes2 = sha256(concatBytes(keyBytes1, new Uint8Array([1])));
  const keyBytes3 = sha256(concatBytes(keyBytes1, new Uint8Array([2])));
  const extendedKey = concatBytes(keyBytes1, keyBytes2, keyBytes3);

  const decrypted = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ extendedKey[i % extendedKey.length];
  }

  // Parse: [ephPriv32(32) + ephPub(32) + noteLen(2) + note]
  // Skip ephPriv32 and ephPub (64 bytes), read noteLen, then note
  const noteLen = decrypted[64] | (decrypted[65] << 8);
  const noteBytes = decrypted.slice(66, 66 + noteLen);

  return new TextDecoder().decode(noteBytes);
}

// ============================================================================
// Stealth Address Derivation (Sender Side)
// ============================================================================

/**
 * Derive a stealth public key from meta-address and ephemeral key
 *
 * Formula: stealth_pubkey = S + H(shared) * G
 *
 * @param metaSpendPub58 - Employee's spend public key (base58)
 * @param metaViewPub58 - Employee's view public key (base58)
 * @param ephPriv32 - Ephemeral private key (32 bytes)
 * @returns Stealth public key as Solana PublicKey
 */
export async function deriveStealthPub(
  metaSpendPub58: string,
  metaViewPub58: string,
  ephPriv32: Uint8Array
): Promise<PublicKey> {
  // 1. ECDH shared secret: shared = eph * V
  const shared = await ed.getSharedSecret(
    ephPriv32,
    new PublicKey(metaViewPub58).toBytes(),
  );

  // 2. Hash to scalar: tweak = H(shared) mod L (big-endian interpretation)
  const tweakHash = sha256(shared);
  const tweak = mod(BigInt('0x' + Buffer.from(tweakHash).toString('hex')), L);

  // 3. Stealth pubkey: S + tweak * G
  const Abytes = new PublicKey(metaSpendPub58).toBytes();
  const A = ed25519.ExtendedPoint.fromHex(Abytes);
  const S = A.add(ed25519.ExtendedPoint.BASE.multiply(tweak));

  return new PublicKey(S.toRawBytes());
}

/**
 * Generate a stealth payment (employer side)
 *
 * Creates a one-time stealth address and encrypted payload for the employee.
 *
 * @param metaAddress - Employee's public meta-address
 * @returns Stealth payment data including address and encrypted payload
 *
 * @example
 * ```typescript
 * const payment = await generateStealthPayment(employee.metaAddress);
 * // Send funds to: payment.stealthAddress
 * // Include in event: payment.ephemeralPubkey
 * // Include in memo: payment.encryptedPayload
 * ```
 */
export async function generateStealthPayment(
  metaAddress: StealthMetaAddress,
  note: string = ''
): Promise<StealthPaymentData> {
  // Generate ephemeral keypair
  const eph = Keypair.generate();
  const ephPriv32 = eph.secretKey.slice(0, 32);

  // Derive stealth address
  const stealthAddress = await deriveStealthPub(
    metaAddress.spendPubkey,
    metaAddress.viewPubkey,
    ephPriv32
  );

  // Encrypt ephemeral private key AND note for recipient
  const encryptedPayload = await encryptPayloadWithNote(
    ephPriv32,
    note,
    metaAddress.viewPubkey
  );

  return {
    stealthAddress,
    ephemeralPubkey: eph.publicKey.toBase58(),
    encryptedPayload,
  };
}

// ============================================================================
// Stealth Key Derivation (Receiver Side)
// ============================================================================

/**
 * Derive the stealth keypair for spending (employee side)
 *
 * Formula: stealth_privkey = s + H(shared)
 *
 * @param metaSpendPrivHex - Employee's spend private key (hex)
 * @param metaViewPub58 - Employee's view public key (base58) - unused but kept for API compat
 * @param ephPriv32 - Decrypted ephemeral private key (32 bytes)
 * @returns StealthSigner that can sign transactions
 */
export async function deriveStealthKeypair(
  metaSpendPrivHex: string,
  metaViewPub58: string,
  ephPriv32: Uint8Array
): Promise<StealthSigner> {
  // 1. Get spend public key from private key bytes (using ed.getPublicKey)
  const metaSpendPub58 = bs58.encode(
    await ed.getPublicKey(Buffer.from(metaSpendPrivHex, 'hex'))
  );

  // 2. Compute expected stealth pubkey via point addition
  const stealthPub = await deriveStealthPub(metaSpendPub58, metaViewPub58, ephPriv32);

  // 3. Compute tweak (same as sender, big-endian interpretation)
  const shared = await ed.getSharedSecret(
    ephPriv32,
    new PublicKey(metaViewPub58).toBytes(),
  );
  const tweakHash = sha256(shared);
  const tweak = mod(BigInt('0x' + Buffer.from(tweakHash).toString('hex')), L);

  // 4. Get spend scalar from seed and compute stealth scalar
  const spendScalar = scalarFromSeed(Buffer.from(metaSpendPrivHex, 'hex'));
  const stealthScalar = mod(spendScalar + tweak, L);
  const stealthScalarBytes = bnTo32BytesLE(stealthScalar);

  // 5. Derive public key from scalar and verify
  const derivedPub = ed25519.ExtendedPoint.BASE.multiply(stealthScalar).toRawBytes();
  const ok = stealthPub.equals(new PublicKey(derivedPub));
  if (!ok) {
    throw new Error('Stealth key derivation mismatch');
  }

  return new StealthSigner(stealthScalarBytes);
}

// ============================================================================
// Payment Scanning
// ============================================================================

/**
 * Check if a stealth payment belongs to us
 *
 * @param viewPrivHex - Our view private key (hex)
 * @param spendPub58 - Our spend public key (base58)
 * @param ephPub58 - Ephemeral public key from event (base58)
 * @param stealthAddress - The stealth address to check
 * @returns True if this payment is ours
 */
export async function isMyStealthPayment(
  viewPrivHex: string,
  spendPub58: string,
  ephPub58: string,
  stealthAddress: PublicKey
): Promise<boolean> {
  try {
    // Compute shared secret: v * R (using ephPub as we don't have ephPriv)
    // Note: We need to derive shared differently on receiver side
    // shared = viewPriv * ephPub
    const shared = await ed.getSharedSecret(
      to32u8(viewPrivHex),
      to32u8(ephPub58),
    );

    // Compute tweak (big-endian interpretation to match sender)
    const tweakHash = sha256(shared);
    const tweak = mod(BigInt('0x' + Buffer.from(tweakHash).toString('hex')), L);

    // Expected stealth pubkey: S + tweak * G
    const spendPubBytes = new PublicKey(spendPub58).toBytes();
    const S = ed25519.ExtendedPoint.fromHex(spendPubBytes);
    const expectedStealth = S.add(ed25519.ExtendedPoint.BASE.multiply(tweak));

    return stealthAddress.equals(new PublicKey(expectedStealth.toRawBytes()));
  } catch {
    return false;
  }
}

/**
 * Scan a list of payments to find ours
 *
 * @param viewPrivHex - Our view private key (hex)
 * @param spendPub58 - Our spend public key (base58)
 * @param payments - List of payments to scan
 * @returns Payments that belong to us
 */
export async function scanForMyPayments(
  viewPrivHex: string,
  spendPub58: string,
  payments: Array<{ ephPub58: string; stealthAddress: PublicKey; data: unknown }>
): Promise<Array<{ ephPub58: string; stealthAddress: PublicKey; data: unknown }>> {
  const myPayments: Array<{ ephPub58: string; stealthAddress: PublicKey; data: unknown }> = [];

  for (const payment of payments) {
    const isMine = await isMyStealthPayment(
      viewPrivHex,
      spendPub58,
      payment.ephPub58,
      payment.stealthAddress
    );
    if (isMine) {
      myPayments.push(payment);
    }
  }

  return myPayments;
}
