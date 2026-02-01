/**
 * Stealth Address Utilities
 *
 * Implements EIP-5564 style stealth addresses for Ed25519/Solana.
 * Reference: contract/lib/stealth-address.ts and example-backend/pivy-backend/src/lib/pivy-stealth
 */

import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'
import { ed25519 } from '@noble/curves/ed25519'
import { x25519 } from '@noble/curves/ed25519'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { randomBytes } from 'crypto'

// Ed25519 curve order
const L = BigInt(
  '0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed'
)

const mod = (x: bigint, n: bigint) => ((x % n) + n) % n

/**
 * Convert various key formats to 32-byte Uint8Array
 */
export function to32u8(raw: Uint8Array | string | { type: string; data: number[] }): Uint8Array {
  if (raw instanceof Uint8Array) return raw
  if (typeof raw === 'string') {
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      return Buffer.from(raw, 'hex')
    }
    return bs58.decode(raw)
  }
  if (typeof raw === 'object' && raw.type === 'Buffer') {
    return Uint8Array.from(raw.data)
  }
  throw new Error('unsupported key format')
}

/**
 * Clamp a private key for Ed25519
 */
function clamp(sk: Uint8Array): Uint8Array {
  const clamped = new Uint8Array(sk)
  clamped[0] &= 248
  clamped[31] &= 127
  clamped[31] |= 64
  return clamped
}

/**
 * Convert bytes to bigint (little-endian)
 */
function bytesToNumberLE(u8: Uint8Array): bigint {
  return u8.reduceRight((p, c) => (p << 8n) + BigInt(c), 0n)
}

/**
 * Convert bigint to 32-byte array (little-endian)
 */
function bnTo32BytesLE(bn: bigint): Uint8Array {
  const bytes = new Uint8Array(32)
  let temp = bn
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(temp & 0xffn)
    temp >>= 8n
  }
  return bytes
}

/**
 * Derive scalar from seed using Ed25519 derivation
 */
function scalarFromSeed(seed32: Uint8Array): bigint {
  const h = sha512(seed32)
  return bytesToNumberLE(clamp(h.slice(0, 32)))
}

/**
 * Get public key from private key
 */
function getPublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey)
}

/**
 * Compute ECDH shared secret using X25519
 *
 * IMPORTANT: This must match the contract's implementation (lib/stealth-address.ts)
 * which uses @noble/ed25519's getSharedSecret.
 *
 * Ed25519 keys must be converted to X25519 format:
 * - Private key: sha512(seed)[0:32] + clamp → X25519 scalar
 * - Public key: birational map from Edwards to Montgomery → X25519 u-coordinate
 */
function getSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  // Convert Ed25519 seed to X25519 scalar (sha512 + clamp)
  const x25519Priv = ed25519.utils.toMontgomerySecret(privateKey)

  // Convert Ed25519 public key to X25519 (Montgomery u-coordinate)
  const x25519Pub = ed25519.utils.toMontgomery(publicKey)

  // Perform X25519 ECDH
  return x25519.getSharedSecret(x25519Priv, x25519Pub)
}

// =============================================================================
// Key Generation
// =============================================================================

export interface StealthMetaKeys {
  metaSpendPriv: Uint8Array // 32 bytes
  metaSpendPub: string // Base58
  metaViewPriv: Uint8Array // 32 bytes
  metaViewPub: string // Base58
}

/**
 * Generate a new stealth meta key pair
 */
export async function generateStealthMetaKeys(): Promise<StealthMetaKeys> {
  // Generate spend keypair
  const metaSpendPriv = new Uint8Array(randomBytes(32))
  const metaSpendPubBytes = getPublicKey(metaSpendPriv)
  const metaSpendPub = bs58.encode(metaSpendPubBytes)

  // Generate view keypair
  const metaViewPriv = new Uint8Array(randomBytes(32))
  const metaViewPubBytes = getPublicKey(metaViewPriv)
  const metaViewPub = bs58.encode(metaViewPubBytes)

  return {
    metaSpendPriv,
    metaSpendPub,
    metaViewPriv,
    metaViewPub,
  }
}

// =============================================================================
// Stealth Address Derivation
// =============================================================================

/**
 * Derive a stealth public key (for creating positions)
 *
 * Used by employer to create a stealth address for employee.
 * S = A + H(shared_secret) * G
 */
export async function deriveStealthPub(
  metaSpendPub58: string,
  metaViewPub58: string,
  ephemeralPriv: Uint8Array
): Promise<PublicKey> {
  // 1. Compute shared secret: ephemeralPriv * metaViewPub
  const metaViewPubBytes = new PublicKey(metaViewPub58).toBytes()
  const shared = getSharedSecret(ephemeralPriv, metaViewPubBytes)

  // 2. Compute tweak: H(shared) mod L
  const tweak = mod(BigInt('0x' + Buffer.from(sha256(shared)).toString('hex')), L)

  // 3. Compute stealth pub: A + tweak * G
  const Abytes = new PublicKey(metaSpendPub58).toBytes()
  const A = ed25519.ExtendedPoint.fromHex(Abytes)
  const S = A.add(ed25519.ExtendedPoint.BASE.multiply(tweak))
  const Sbytes = S.toRawBytes()

  return new PublicKey(Sbytes)
}

/**
 * Check if a stealth address belongs to a user (using view key)
 *
 * Used for scanning positions to find ones belonging to user.
 */
export async function isMyStealthAddress(
  stealthOwner58: string,
  ephemeralPub58: string,
  metaSpendPub58: string,
  metaViewPriv: Uint8Array
): Promise<boolean> {
  // 1. Compute shared secret: metaViewPriv * ephemeralPub
  const ephemeralPubBytes = to32u8(ephemeralPub58)
  const shared = getSharedSecret(metaViewPriv, ephemeralPubBytes)

  // 2. Compute tweak
  const tweak = mod(BigInt('0x' + Buffer.from(sha256(shared)).toString('hex')), L)

  // 3. Compute expected stealth pub
  const Abytes = new PublicKey(metaSpendPub58).toBytes()
  const A = ed25519.ExtendedPoint.fromHex(Abytes)
  const S = A.add(ed25519.ExtendedPoint.BASE.multiply(tweak))
  const expectedStealthPub = new PublicKey(S.toRawBytes())

  // 4. Compare
  return expectedStealthPub.toBase58() === stealthOwner58
}

/**
 * Derive stealth private key for signing (for claiming)
 *
 * Used by employee to derive the private key to sign withdrawal.
 * s = a + H(shared_secret) mod L
 */
export async function deriveStealthPrivKey(
  metaSpendPriv: Uint8Array,
  metaViewPub58: string,
  ephemeralPriv: Uint8Array
): Promise<Uint8Array> {
  // 1. Compute shared secret
  const metaViewPubBytes = new PublicKey(metaViewPub58).toBytes()
  const shared = getSharedSecret(ephemeralPriv, metaViewPubBytes)

  // 2. Compute tweak
  const tweak = mod(BigInt('0x' + Buffer.from(sha256(shared)).toString('hex')), L)

  // 3. Derive stealth scalar
  const a = scalarFromSeed(metaSpendPriv)
  const s = mod(a + tweak, L)

  return bnTo32BytesLE(s)
}

// =============================================================================
// Encryption/Decryption (for notes/memos)
// =============================================================================

/**
 * Encrypt a note using ECDH shared secret
 */
export async function encryptNote(
  plaintext: string,
  ephemeralPriv: Uint8Array,
  metaViewPub58: string
): Promise<string> {
  // 1. Shared secret
  const metaViewPubBytes = new PublicKey(metaViewPub58).toBytes()
  const shared = getSharedSecret(ephemeralPriv, metaViewPubBytes)
  const keyBytes = sha256(shared)

  // 2. Convert plaintext to bytes
  const plaintextBytes = new TextEncoder().encode(plaintext)

  // 3. XOR encrypt
  const enc = new Uint8Array(plaintextBytes.length)
  for (let i = 0; i < plaintextBytes.length; i++) {
    enc[i] = plaintextBytes[i] ^ keyBytes[i % keyBytes.length]
  }

  // 4. Prepend random nonce
  const nonce = new Uint8Array(randomBytes(24))
  const payload = new Uint8Array([...nonce, ...enc])

  return bs58.encode(payload)
}

/**
 * Decrypt a note using ECDH shared secret
 */
export async function decryptNote(
  encodedNote: string,
  metaViewPriv: Uint8Array,
  ephemeralPub58: string
): Promise<string> {
  const payload = bs58.decode(encodedNote)
  const encrypted = payload.slice(24) // Skip nonce

  // Shared secret
  const ephemeralPubBytes = to32u8(ephemeralPub58)
  const shared = getSharedSecret(metaViewPriv, ephemeralPubBytes)
  const keyBytes = sha256(shared)

  // XOR decrypt
  const dec = new Uint8Array(encrypted.length)
  for (let i = 0; i < encrypted.length; i++) {
    dec[i] = encrypted[i] ^ keyBytes[i % keyBytes.length]
  }

  return new TextDecoder().decode(dec)
}

// =============================================================================
// Ephemeral Key Generation
// =============================================================================

export interface EphemeralKeypair {
  ephemeralPriv: Uint8Array
  ephemeralPub: string // Base58
}

/**
 * Generate ephemeral keypair for creating a stealth payment
 */
export async function generateEphemeralKeypair(): Promise<EphemeralKeypair> {
  const ephemeralPriv = new Uint8Array(randomBytes(32))
  const ephemeralPubBytes = getPublicKey(ephemeralPriv)
  const ephemeralPub = bs58.encode(ephemeralPubBytes)

  return { ephemeralPriv, ephemeralPub }
}
