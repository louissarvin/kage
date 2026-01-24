/**
 * ShadowVest Poseidon BN254 Hash Utilities
 *
 * Lightweight Poseidon hasher for the bn254 (alt_bn128) curve that matches
 * Noir's `poseidon::bn254::hash_1` and `poseidon::bn254::hash_2` implementations.
 *
 * Used for computing commitments and nullifiers off-chain without running
 * a full Noir proof. Both circomlibjs and Noir use the same reference
 * Poseidon constants for the BN254 scalar field.
 *
 * Field modulus (r - the scalar field order of BN254):
 *   21888242871839275222246405745257275088548364400416034343698204186575808495617
 *
 * @module poseidon-bn254
 */

import { buildPoseidon } from 'circomlibjs';

// ============================================================================
// Constants
// ============================================================================

/** BN254 scalar field modulus (r) */
const BN254_FIELD_ORDER = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// ============================================================================
// Singleton Poseidon instance
// ============================================================================

let poseidonInstance: any = null;

/**
 * Get or initialize the shared Poseidon instance.
 * Uses circomlibjs which implements the same Poseidon constants as Noir's
 * bn254 implementation.
 */
async function getPoseidon(): Promise<any> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

// ============================================================================
// Hash Functions
// ============================================================================

/**
 * Poseidon hash with 1 input (matches Noir's poseidon::bn254::hash_1).
 *
 * In Noir: `poseidon::bn254::hash_1([input])`
 * This uses t=2 (1 input + 1 capacity element) in the Poseidon permutation.
 *
 * @param input - The field element to hash (as bigint)
 * @returns The hash output as a bigint in the BN254 scalar field
 */
export async function poseidonHash1(input: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon([input]);
  return poseidon.F.toObject(hash);
}

/**
 * Poseidon hash with 2 inputs (matches Noir's poseidon::bn254::hash_2).
 *
 * In Noir: `poseidon::bn254::hash_2([a, b])`
 * This uses t=3 (2 inputs + 1 capacity element) in the Poseidon permutation.
 *
 * @param a - First field element
 * @param b - Second field element
 * @returns The hash output as a bigint in the BN254 scalar field
 */
export async function poseidonHash2(a: bigint, b: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon([a, b]);
  return poseidon.F.toObject(hash);
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Convert a bigint to a 32-byte big-endian Uint8Array.
 * This matches the format expected by Solana's on-chain verifier
 * (public inputs are 32-byte big-endian scalars).
 *
 * @param value - The bigint to convert (must be < BN254 field order)
 * @returns 32-byte big-endian representation
 * @throws If value is negative or >= field order
 */
export function bigintToBytes32(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error('bigintToBytes32: value must be non-negative');
  }
  if (value >= BN254_FIELD_ORDER) {
    throw new Error('bigintToBytes32: value exceeds BN254 field order');
  }

  const bytes = new Uint8Array(32);
  let remaining = value;

  // Fill from the least significant byte (index 31) to most significant (index 0)
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xFFn);
    remaining >>= 8n;
  }

  return bytes;
}

/**
 * Convert a 32-byte big-endian Uint8Array to bigint.
 *
 * @param bytes - 32-byte big-endian representation
 * @returns The bigint value
 * @throws If bytes is not exactly 32 bytes
 */
export function bytes32ToBigint(bytes: Uint8Array): bigint {
  if (bytes.length !== 32) {
    throw new Error(`bytes32ToBigint: expected 32 bytes, got ${bytes.length}`);
  }

  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }

  return result;
}

/**
 * Convert a hex string (with or without 0x prefix) to bigint.
 *
 * @param hex - Hex string, optionally prefixed with "0x"
 * @returns The parsed bigint
 * @throws If the hex string is invalid
 */
export function hexToBigint(hex: string): bigint {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleaned.length === 0) {
    throw new Error('hexToBigint: empty hex string');
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('hexToBigint: invalid hex characters');
  }
  return BigInt('0x' + cleaned);
}

/**
 * Convert bigint to hex string (no 0x prefix, zero-padded to 64 characters).
 * This matches the Noir field representation format.
 *
 * @param value - The bigint to convert
 * @returns 64-character hex string (256-bit representation)
 */
export function bigintToHex(value: bigint): string {
  if (value < 0n) {
    throw new Error('bigintToHex: value must be non-negative');
  }
  const hex = value.toString(16);
  return hex.padStart(64, '0');
}

/**
 * Convert a hex field string to 32-byte big-endian Uint8Array.
 * Combines hexToBigint and bigintToBytes32 for convenience.
 *
 * @param hex - Hex string (with or without 0x prefix)
 * @returns 32-byte big-endian Uint8Array
 */
export function hexToBytes32(hex: string): Uint8Array {
  return bigintToBytes32(hexToBigint(hex));
}

/**
 * Convert a 32-byte big-endian Uint8Array to 0x-prefixed hex string.
 *
 * @param bytes - 32-byte array
 * @returns 0x-prefixed hex string
 */
export function bytes32ToHex(bytes: Uint8Array): string {
  return '0x' + bigintToHex(bytes32ToBigint(bytes));
}

/**
 * Convert a u64 value to a 32-byte big-endian scalar.
 * The u64 occupies the last 8 bytes (big-endian), with the first 24 bytes zeroed.
 * This matches how the on-chain verifier encodes epoch_id.
 *
 * @param value - u64 value as bigint
 * @returns 32-byte big-endian scalar
 */
export function u64ToScalar(value: bigint): Uint8Array {
  if (value < 0n || value > 0xFFFFFFFFFFFFFFFFn) {
    throw new Error('u64ToScalar: value out of u64 range');
  }
  const bytes = new Uint8Array(32);
  // Write the u64 in big-endian into the last 8 bytes
  for (let i = 7; i >= 0; i--) {
    bytes[24 + i] = Number(value & 0xFFn);
    value >>= 8n;
  }
  return bytes;
}
