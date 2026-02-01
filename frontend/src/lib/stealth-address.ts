/**
 * ShadowVest Stealth Address Library (Browser-compatible)
 *
 * ECDH-based stealth addresses for receiver privacy on Solana.
 * Adapted from contract/lib/stealth-address.ts for browser environment.
 */

import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'
import { ed25519, x25519 } from '@noble/curves/ed25519'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

// ============================================================================
// Constants
// ============================================================================

/** Ed25519 curve order (L) */
const L = BigInt(
  '0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed',
)

// ============================================================================
// Types
// ============================================================================

export interface StealthMetaAddress {
  spendPubkey: string // base58
  viewPubkey: string // base58
}

export interface StealthMetaKeys {
  spendPrivKey: string // hex
  viewPrivKey: string // hex
  metaAddress: StealthMetaAddress
}

/**
 * Custom signer for stealth private keys
 */
export class StealthSigner {
  private scalarBytes: Uint8Array
  private scalar: bigint
  public publicKey: PublicKey

  constructor(scalarBytes: Uint8Array) {
    this.scalarBytes = scalarBytes
    this.scalar = bytesToNumberLE(scalarBytes)
    this.publicKey = new PublicKey(
      ed25519.ExtendedPoint.BASE.multiply(this.scalar).toRawBytes()
    )
  }

  async signMessage(message: Uint8Array | Buffer): Promise<Uint8Array> {
    const msg = message instanceof Uint8Array ? message : new Uint8Array(message)

    // Ed25519 signature generation from scalar
    const prefix = sha512(this.scalarBytes).slice(32)
    const r = mod(bytesToNumberLE(sha512(concatBytes(prefix, msg))), L)
    const R = ed25519.ExtendedPoint.BASE.multiply(r)
    const A = ed25519.ExtendedPoint.BASE.multiply(this.scalar)

    const hramInput = concatBytes(R.toRawBytes(), A.toRawBytes(), msg)
    const h = mod(bytesToNumberLE(sha512(hramInput)), L)
    const s = mod(r + h * this.scalar, L)

    return concatBytes(R.toRawBytes(), bnTo32BytesLE(s))
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

const mod = (x: bigint, n: bigint): bigint => ((x % n) + n) % n

const to32u8 = (raw: Uint8Array | string | Buffer): Uint8Array =>
  raw instanceof Uint8Array
    ? raw
    : typeof raw === 'string' && /^[0-9a-f]{64}$/i.test(raw)
    ? hexToBytes(raw)
    : typeof raw === 'string'
    ? bs58.decode(raw)
    : Buffer.isBuffer(raw)
    ? new Uint8Array(raw)
    : (() => { throw new Error('unsupported key format') })()

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function clamp(sk: Uint8Array): Uint8Array {
  const clamped = new Uint8Array(sk)
  clamped[0] &= 248
  clamped[31] &= 127
  clamped[31] |= 64
  return clamped
}

function bytesToNumberLE(u8: Uint8Array): bigint {
  let result = BigInt(0)
  for (let i = u8.length - 1; i >= 0; i--) {
    result = (result << BigInt(8)) + BigInt(u8[i])
  }
  return result
}

function bnTo32BytesLE(bn: bigint): Uint8Array {
  const bytes = new Uint8Array(32)
  let temp = bn
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(temp & BigInt(0xff))
    temp >>= BigInt(8)
  }
  return bytes
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

/**
 * X25519 ECDH for shared secret
 *
 * IMPORTANT: This MUST match the contract's implementation (lib/stealth-address.ts)
 * which uses @noble/ed25519's getSharedSecret.
 *
 * The @noble/ed25519 getSharedSecret does:
 * 1. Convert Ed25519 private key seed to X25519 scalar: sha512(seed)[0:32] + clamp
 * 2. Convert Ed25519 public key to X25519 u-coordinate: birational map
 * 3. Perform X25519 scalar multiplication
 *
 * We replicate this using @noble/curves utilities:
 * - ed25519.utils.toMontgomerySecret(privateKey) - converts Ed25519 seed to X25519 scalar
 * - ed25519.utils.toMontgomery(publicKey) - converts Ed25519 public to X25519 u-coordinate
 */
function getSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  // Convert Ed25519 seed to X25519 scalar (sha512 + clamp)
  const x25519Priv = ed25519.utils.toMontgomerySecret(privateKey)

  // Convert Ed25519 public key to X25519 (Montgomery u-coordinate)
  const x25519Pub = ed25519.utils.toMontgomery(publicKey)

  // Perform X25519 ECDH
  return x25519.getSharedSecret(x25519Priv, x25519Pub)
}

// Reserved for future use - derives public key from private key
async function _getPublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
  const scalar = bytesToNumberLE(clamp(sha512(privateKey).slice(0, 32)))
  return ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes()
}
void _getPublicKey // Suppress unused warning

// ============================================================================
// Decryption (Receiver Side)
// ============================================================================

/**
 * Decrypt the ephemeral private key
 *
 * Handles TWO different encryption formats:
 *
 * 1. BACKEND format (encryptNote in backend/src/lib/stealth.ts):
 *    - Simple 32-byte key: sha256(shared)
 *    - Encrypts: hex string of ephPriv (64 characters)
 *    - Payload: bs58([24-nonce][64-encrypted])
 *
 * 2. CONTRACT format (encryptPayloadWithNote in contract/lib/stealth-address.ts):
 *    - Extended 96-byte key: sha256(shared) + sha256(key1+[1]) + sha256(key1+[2])
 *    - Encrypts: ephPriv32 + ephPub + noteLen + note (binary)
 *    - Payload: base64([24-nonce][encrypted])
 *
 * Detection: If payload contains base64 chars (+/=), use contract format.
 * Otherwise use backend format (bs58).
 */
export async function decryptEphemeralPrivKey(
  encodedPayload: string,
  metaViewPrivHex: string,
  ephPub58: string
): Promise<Uint8Array> {
  // Detect format: base64 (contract) vs bs58 (backend)
  const isContractFormat = encodedPayload.includes('+') ||
                           encodedPayload.includes('/') ||
                           encodedPayload.endsWith('=')

  let payload: Uint8Array
  if (isContractFormat) {
    payload = Uint8Array.from(atob(encodedPayload), c => c.charCodeAt(0))
  } else {
    payload = bs58.decode(encodedPayload)
  }

  console.log('[decryptEphemeralPrivKey] Format:', isContractFormat ? 'CONTRACT' : 'BACKEND')
  console.log('[decryptEphemeralPrivKey] Payload length:', payload.length)

  // Compute shared secret: viewPriv * ephPub
  const shared = getSharedSecret(
    to32u8(metaViewPrivHex),
    to32u8(ephPub58),
  )

  console.log('[decryptEphemeralPrivKey] Shared secret (first 8):', bytesToHex(shared.slice(0, 8)))

  let ephPriv32: Uint8Array

  if (isContractFormat) {
    // CONTRACT FORMAT: extended key, binary plaintext
    const encrypted = payload.slice(24)
    console.log('[decryptEphemeralPrivKey] Encrypted length:', encrypted.length)

    // Extended key (96 bytes)
    const keyBytes1 = sha256(shared)
    const keyBytes2 = sha256(concatBytes(keyBytes1, new Uint8Array([1])))
    const keyBytes3 = sha256(concatBytes(keyBytes1, new Uint8Array([2])))
    const extendedKey = concatBytes(keyBytes1, keyBytes2, keyBytes3)

    // XOR decrypt
    const decrypted = new Uint8Array(encrypted.length)
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ extendedKey[i % extendedKey.length]
    }

    // Extract ephPriv32 (first 32 bytes)
    ephPriv32 = decrypted.slice(0, 32)
  } else {
    // BACKEND FORMAT: simple key, hex string plaintext
    // Backend encrypts 64-char hex string, stored in 128-byte buffer on-chain
    // Only decrypt the first 64 bytes after nonce (the actual encrypted data)
    const encrypted = payload.slice(24, 24 + 64) // Skip nonce, take 64 bytes
    console.log('[decryptEphemeralPrivKey] Encrypted length:', encrypted.length)

    // Simple key (32 bytes)
    const keyBytes = sha256(shared)

    // XOR decrypt
    const decrypted = new Uint8Array(encrypted.length)
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ keyBytes[i % keyBytes.length]
    }

    // Decode as UTF-8 hex string, convert to 32-byte binary
    const decryptedHex = new TextDecoder().decode(decrypted)
    console.log('[decryptEphemeralPrivKey] Decrypted hex:', decryptedHex.slice(0, 16) + '...')
    ephPriv32 = hexToBytes(decryptedHex)
  }

  // Verify: compute public key from decrypted private key
  const derivedEphPub = ed25519.getPublicKey(ephPriv32)
  const expectedEphPub = to32u8(ephPub58)
  const matchesProvided = derivedEphPub.every((b, i) => b === expectedEphPub[i])

  console.log('[decryptEphemeralPrivKey] Verification:')
  console.log('  Derived ephPub:', bs58.encode(derivedEphPub).slice(0, 16) + '...')
  console.log('  Expected ephPub:', ephPub58.slice(0, 16) + '...')
  console.log('  Match:', matchesProvided)

  if (!matchesProvided) {
    console.error('[decryptEphemeralPrivKey] WARNING: Decrypted ephemeral key does not match!')
  }

  return ephPriv32
}

// ============================================================================
// Stealth Key Derivation (Receiver Side)
// ============================================================================

/**
 * Derive stealth public key from meta-address and ephemeral key
 */
export async function deriveStealthPub(
  metaSpendPub58: string,
  metaViewPub58: string,
  ephPriv32: Uint8Array
): Promise<PublicKey> {
  const shared = getSharedSecret(
    ephPriv32,
    new PublicKey(metaViewPub58).toBytes(),
  )

  const tweakHash = sha256(shared)
  const tweak = mod(BigInt('0x' + bytesToHex(tweakHash)), L)

  const Abytes = new PublicKey(metaSpendPub58).toBytes()
  const A = ed25519.ExtendedPoint.fromHex(Abytes)
  const S = A.add(ed25519.ExtendedPoint.BASE.multiply(tweak))

  return new PublicKey(S.toRawBytes())
}

/**
 * Derive stealth keypair for signing claims
 */
export async function deriveStealthKeypair(
  metaSpendPrivHex: string,
  metaViewPub58: string,
  ephPriv32: Uint8Array
): Promise<StealthSigner> {
  // Get spend private key bytes
  const spendPrivBytes = hexToBytes(metaSpendPrivHex)

  // Compute tweak
  const shared = getSharedSecret(
    ephPriv32,
    new PublicKey(metaViewPub58).toBytes(),
  )
  const tweakHash = sha256(shared)
  const tweak = mod(BigInt('0x' + bytesToHex(tweakHash)), L)

  // Derive spend scalar from private key seed
  const spendScalar = bytesToNumberLE(clamp(sha512(spendPrivBytes).slice(0, 32)))

  // stealth_scalar = spend_scalar + tweak (mod L)
  const stealthScalar = mod(spendScalar + tweak, L)
  const stealthScalarBytes = bnTo32BytesLE(stealthScalar)

  return new StealthSigner(stealthScalarBytes)
}

/**
 * Check if a stealth payment belongs to this employee
 *
 * IMPORTANT: Parameter order matches contract/lib/stealth-address.ts
 *
 * @param viewPrivHex - Our view private key (hex, 32 bytes)
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
    // First, verify that our keys are consistent by deriving public keys
    const viewPrivBytes = to32u8(viewPrivHex)
    const derivedViewPub = ed25519.getPublicKey(viewPrivBytes)
    const derivedViewPub58 = bs58.encode(derivedViewPub)

    console.log('[isMyStealthPayment] Key verification:')
    console.log('  viewPrivHex (first 16 chars):', viewPrivHex.slice(0, 16) + '...')
    console.log('  Derived viewPub from viewPriv:', derivedViewPub58.slice(0, 16) + '...')
    console.log('  spendPub provided:', spendPub58.slice(0, 16) + '...')

    // Compute shared secret: viewPriv * ephPub
    const ephPubBytes = to32u8(ephPub58)
    const shared = getSharedSecret(viewPrivBytes, ephPubBytes)

    console.log('  Shared secret (first 8 bytes):', bytesToHex(shared.slice(0, 8)))

    // Compute tweak (big-endian interpretation to match sender)
    const tweakHash = sha256(shared)
    const tweak = mod(BigInt('0x' + bytesToHex(tweakHash)), L)

    console.log('  Tweak hash (first 8 bytes):', bytesToHex(tweakHash.slice(0, 8)))

    // Expected stealth pubkey: S + tweak * G
    const spendPubBytes = new PublicKey(spendPub58).toBytes()
    const S = ed25519.ExtendedPoint.fromHex(spendPubBytes)
    const expectedStealth = S.add(ed25519.ExtendedPoint.BASE.multiply(tweak))
    const expectedAddress = new PublicKey(expectedStealth.toRawBytes())

    // Debug logging
    console.log('[isMyStealthPayment] Address comparison:')
    console.log('  Expected:', expectedAddress.toBase58())
    console.log('  Actual:  ', stealthAddress.toBase58())
    console.log('  Match:', expectedAddress.equals(stealthAddress))

    return expectedAddress.equals(stealthAddress)
  } catch (err) {
    console.error('[isMyStealthPayment] Error:', err)
    return false
  }
}

/**
 * Create nullifier for a claim
 * nullifier = SHA256(stealth_address || position_id)
 */
export function createNullifier(
  stealthAddress: PublicKey,
  positionId: number
): Uint8Array {
  const positionIdBytes = new Uint8Array(8)
  const view = new DataView(positionIdBytes.buffer)
  view.setBigUint64(0, BigInt(positionId), true) // little-endian

  return sha256(concatBytes(stealthAddress.toBytes(), positionIdBytes))
}
