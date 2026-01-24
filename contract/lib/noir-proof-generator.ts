/**
 * ShadowVest Noir ZK Proof Generator
 *
 * TypeScript client library for generating Noir ZK proofs (Groth16 via Barretenberg)
 * and building Solana transaction instructions for on-chain verification.
 *
 * Supports three circuits:
 * - withdrawal_proof: Proves withdrawal entitlement from a vesting position
 * - identity_proof: Proves ownership of a vesting position
 * - eligibility: Lightweight pre-check for claim eligibility
 *
 * Architecture:
 *   NoirJS (circuit execution) -> Barretenberg (Groth16 proving) -> Solana (on-chain verify)
 *
 * @module noir-proof-generator
 */

import { Noir } from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import {
  poseidonHash1,
  poseidonHash2,
  bigintToBytes32,
  bytes32ToBigint,
  hexToBigint,
  bigintToHex,
  u64ToScalar,
  hexToBytes32,
} from './poseidon-bn254';

// ============================================================================
// Types
// ============================================================================

/**
 * Compiled Noir circuit artifact (output of `nargo compile`).
 * Contains the circuit bytecode and ABI definition.
 */
export interface CircuitArtifact {
  bytecode: string;
  abi: any;
}

/**
 * Supported circuit names in the ShadowVest system.
 */
export type CircuitName = 'withdrawal_proof' | 'identity_proof' | 'eligibility';

// ----------------------------------------------------------------------------
// Proof Input Types (matching the Noir circuits)
// ----------------------------------------------------------------------------

/**
 * Inputs for the withdrawal_proof circuit.
 *
 * Public inputs (visible on-chain after verification):
 * - state_root: Merkle root of the vesting state tree
 * - epoch_id: Current epoch identifier for time-locking
 * - nullifier: Unique per identity+epoch, prevents double-claims
 * - withdrawal_commitment: Poseidon hash of the claimed amount
 *
 * Private inputs (known only to the prover):
 * - vesting_amount: Total vesting amount for this position
 * - identity_secret: Secret key material for identity derivation
 * - vesting_path: Merkle proof siblings (32-level tree)
 * - claimed_amount: Amount the prover wishes to withdraw
 */
export interface WithdrawalProofInputs {
  // Public
  state_root: string;           // Field as hex string (0x-prefixed or raw)
  epoch_id: bigint;             // u64 epoch identifier
  nullifier: string;            // Field as hex string
  withdrawal_commitment: string; // Field as hex string
  // Private
  vesting_amount: bigint;       // u64 total vesting amount
  identity_secret: string;      // Field as hex string
  vesting_path: string[];       // Array of 32 Field elements (hex strings)
  claimed_amount: bigint;       // u64 amount being claimed
}

/**
 * Inputs for the identity_proof circuit.
 *
 * Public input:
 * - position_commitment: The on-chain commitment to the vesting position
 *
 * Private inputs:
 * - identity_preimage: Secret identity value (pre-hash)
 * - position_data: [encrypted_amount, start_time, cliff, duration]
 */
export interface IdentityProofInputs {
  // Public
  position_commitment: string;  // Field as hex string
  // Private
  identity_preimage: string;    // Field as hex string
  position_data: string[];      // Array of 4 Field elements (hex strings)
}

/**
 * Inputs for the eligibility circuit.
 *
 * Public inputs:
 * - beneficiary_commitment: Poseidon(identity_secret)
 * - nullifier: Poseidon(identity_secret, position_id)
 * - position_id: Identifies the vesting position
 * - position_commitment: Poseidon(identity_commitment, vesting_amount)
 *
 * Private inputs:
 * - identity_secret: Stealth key material
 * - vesting_amount: Total vesting amount (for position binding)
 */
export interface EligibilityProofInputs {
  // Public
  beneficiary_commitment: string; // Field as hex string
  nullifier: string;              // Field as hex string
  position_id: string;            // Field as hex string
  position_commitment: string;    // Field as hex string
  // Private
  identity_secret: string;        // Field as hex string
  vesting_amount: bigint;         // u64 total vesting amount
}

// ----------------------------------------------------------------------------
// Proof Output Types (matching on-chain Groth16Proof struct)
// ----------------------------------------------------------------------------

/**
 * Groth16 proof formatted for Solana's on-chain verifier.
 *
 * Points are in uncompressed big-endian format:
 * - G1 points: 64 bytes (32-byte x || 32-byte y)
 * - G2 points: 128 bytes (64-byte x || 64-byte y, each coordinate is 2x32 bytes)
 */
export interface SolanaGroth16Proof {
  /** Proof point A on G1 - 64 bytes uncompressed */
  a: Uint8Array;
  /** Proof point B on G2 - 128 bytes uncompressed */
  b: Uint8Array;
  /** Proof point C on G1 - 64 bytes uncompressed */
  c: Uint8Array;
}

/**
 * Complete proof result including formatted proof and public inputs.
 * Ready to be passed to the on-chain verification instruction.
 */
export interface ProofResult {
  /** Groth16 proof points formatted for Solana */
  proof: SolanaGroth16Proof;
  /** Public inputs as 32-byte big-endian scalars (ordered as in circuit declaration) */
  publicInputs: Uint8Array[];
}

// ============================================================================
// Main Class: ShadowVestProver
// ============================================================================

/**
 * ShadowVest proof generator using NoirJS and Barretenberg.
 *
 * Usage:
 * ```typescript
 * const prover = new ShadowVestProver();
 * await prover.initialize({
 *   withdrawal_proof: withdrawalArtifact,
 *   identity_proof: identityArtifact,
 *   eligibility: eligibilityArtifact,
 * });
 *
 * const result = await prover.generateWithdrawalProof({ ... });
 * const ix = buildVerifyWithdrawalIx(programId, verifier, vkAccount, result);
 * ```
 */
export class ShadowVestProver {
  private backends: Map<string, BarretenbergBackend>;
  private noirs: Map<string, Noir>;
  private initialized: boolean;

  constructor() {
    this.backends = new Map();
    this.noirs = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the prover with compiled circuit artifacts.
   * Must be called before generating any proofs.
   *
   * This instantiates the Barretenberg WASM backend for each circuit,
   * which includes downloading and compiling the WASM module on first use.
   *
   * @param circuits - Map of circuit name to compiled artifact JSON.
   *   Expected keys: 'withdrawal_proof', 'identity_proof', 'eligibility'
   * @throws If any circuit fails to initialize
   */
  async initialize(circuits: Record<string, CircuitArtifact>): Promise<void> {
    for (const [name, artifact] of Object.entries(circuits)) {
      const backend = new BarretenbergBackend(artifact as any);
      const noir = new Noir(artifact as any);

      this.backends.set(name, backend);
      this.noirs.set(name, noir);
    }

    this.initialized = true;
  }

  /**
   * Generate a withdrawal proof.
   *
   * Circuit proves:
   * 1. The prover knows identity_secret such that Poseidon(identity_secret) is committed
   * 2. A position leaf exists in the Merkle tree at state_root
   * 3. The nullifier is correctly derived from (identity_secret, epoch_id)
   * 4. claimed_amount <= vesting_amount
   * 5. withdrawal_commitment = Poseidon(claimed_amount)
   *
   * @param inputs - Withdrawal proof inputs (public + private)
   * @returns Formatted proof ready for on-chain verification
   * @throws If prover is not initialized or proof generation fails
   */
  async generateWithdrawalProof(inputs: WithdrawalProofInputs): Promise<ProofResult> {
    this.ensureInitialized();
    this.validateWithdrawalInputs(inputs);

    const noir = this.noirs.get('withdrawal_proof')!;
    const backend = this.backends.get('withdrawal_proof')!;

    // Format inputs for Noir (hex strings for Field, string numbers for integers)
    const witnessInputs = {
      state_root: normalizeHexField(inputs.state_root),
      epoch_id: inputs.epoch_id.toString(),
      nullifier: normalizeHexField(inputs.nullifier),
      withdrawal_commitment: normalizeHexField(inputs.withdrawal_commitment),
      vesting_amount: inputs.vesting_amount.toString(),
      identity_secret: normalizeHexField(inputs.identity_secret),
      vesting_path: inputs.vesting_path.map(normalizeHexField),
      claimed_amount: inputs.claimed_amount.toString(),
    };

    // Generate witness and proof
    const { witness } = await noir.execute(witnessInputs);
    const rawProof = await backend.generateProof(witness);

    // Format for Solana
    const proof = formatProofForSolana(rawProof.proof);
    const publicInputs = formatPublicInputsForSolana(rawProof.publicInputs);

    return { proof, publicInputs };
  }

  /**
   * Generate an identity proof.
   *
   * Circuit proves:
   * 1. The prover knows identity_preimage such that Poseidon(identity_preimage) is the identity
   * 2. The position_commitment can be reconstructed from the private position_data
   *
   * @param inputs - Identity proof inputs (public + private)
   * @returns Formatted proof ready for on-chain verification
   */
  async generateIdentityProof(inputs: IdentityProofInputs): Promise<ProofResult> {
    this.ensureInitialized();
    this.validateIdentityInputs(inputs);

    const noir = this.noirs.get('identity_proof')!;
    const backend = this.backends.get('identity_proof')!;

    const witnessInputs = {
      position_commitment: normalizeHexField(inputs.position_commitment),
      identity_preimage: normalizeHexField(inputs.identity_preimage),
      position_data: inputs.position_data.map(normalizeHexField),
    };

    const { witness } = await noir.execute(witnessInputs);
    const rawProof = await backend.generateProof(witness);

    const proof = formatProofForSolana(rawProof.proof);
    const publicInputs = formatPublicInputsForSolana(rawProof.publicInputs);

    return { proof, publicInputs };
  }

  /**
   * Generate an eligibility proof.
   *
   * Circuit proves:
   * 1. The prover knows identity_secret matching beneficiary_commitment
   * 2. The nullifier is correctly derived from (identity_secret, position_id)
   * 3. The position_commitment binds (identity_commitment, vesting_amount)
   *
   * @param inputs - Eligibility proof inputs (public + private)
   * @returns Formatted proof ready for on-chain verification
   */
  async generateEligibilityProof(inputs: EligibilityProofInputs): Promise<ProofResult> {
    this.ensureInitialized();
    this.validateEligibilityInputs(inputs);

    const noir = this.noirs.get('eligibility')!;
    const backend = this.backends.get('eligibility')!;

    // Note: The eligibility circuit's main() has private inputs first, then public.
    // However, NoirJS maps by name, so order does not matter in the input object.
    const witnessInputs = {
      identity_secret: normalizeHexField(inputs.identity_secret),
      vesting_amount: inputs.vesting_amount.toString(),
      beneficiary_commitment: normalizeHexField(inputs.beneficiary_commitment),
      nullifier: normalizeHexField(inputs.nullifier),
      position_id: normalizeHexField(inputs.position_id),
      position_commitment: normalizeHexField(inputs.position_commitment),
    };

    const { witness } = await noir.execute(witnessInputs);
    const rawProof = await backend.generateProof(witness);

    const proof = formatProofForSolana(rawProof.proof);
    const publicInputs = formatPublicInputsForSolana(rawProof.publicInputs);

    return { proof, publicInputs };
  }

  /**
   * Verify a proof locally using the Barretenberg backend.
   * Useful for testing and debugging before submitting on-chain.
   *
   * @param circuitName - Name of the circuit ('withdrawal_proof', 'identity_proof', 'eligibility')
   * @param proof - The proof result to verify
   * @returns true if the proof is valid, false otherwise
   */
  async verifyLocally(circuitName: string, proof: ProofResult): Promise<boolean> {
    this.ensureInitialized();

    const backend = this.backends.get(circuitName);
    if (!backend) {
      throw new Error(`Unknown circuit: ${circuitName}. Available: ${Array.from(this.backends.keys()).join(', ')}`);
    }

    // Reconstruct the raw proof format expected by Barretenberg verify
    const rawProof = reconstructRawProof(proof.proof);
    const publicInputs = proof.publicInputs.map(
      (pi) => '0x' + bigintToHex(bytes32ToBigint(pi))
    );

    try {
      const isValid = await backend.verifyProof({
        proof: rawProof,
        publicInputs,
      });
      return isValid;
    } catch {
      return false;
    }
  }

  /**
   * Clean up WASM resources held by Barretenberg backends.
   * Call this when the prover is no longer needed to free memory.
   */
  async destroy(): Promise<void> {
    for (const backend of this.backends.values()) {
      await backend.destroy();
    }
    this.backends.clear();
    this.noirs.clear();
    this.initialized = false;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'ShadowVestProver not initialized. Call initialize() with circuit artifacts first.'
      );
    }
  }

  private validateWithdrawalInputs(inputs: WithdrawalProofInputs): void {
    if (!inputs.state_root) throw new Error('Missing state_root');
    if (inputs.epoch_id === undefined || inputs.epoch_id === null) throw new Error('Missing epoch_id');
    if (!inputs.nullifier) throw new Error('Missing nullifier');
    if (!inputs.withdrawal_commitment) throw new Error('Missing withdrawal_commitment');
    if (inputs.vesting_amount === undefined) throw new Error('Missing vesting_amount');
    if (!inputs.identity_secret) throw new Error('Missing identity_secret');
    if (!inputs.vesting_path || inputs.vesting_path.length !== 32) {
      throw new Error('vesting_path must be an array of exactly 32 Field elements');
    }
    if (inputs.claimed_amount === undefined) throw new Error('Missing claimed_amount');
    if (inputs.claimed_amount > inputs.vesting_amount) {
      throw new Error('claimed_amount exceeds vesting_amount');
    }
  }

  private validateIdentityInputs(inputs: IdentityProofInputs): void {
    if (!inputs.position_commitment) throw new Error('Missing position_commitment');
    if (!inputs.identity_preimage) throw new Error('Missing identity_preimage');
    if (!inputs.position_data || inputs.position_data.length !== 4) {
      throw new Error('position_data must be an array of exactly 4 Field elements');
    }
  }

  private validateEligibilityInputs(inputs: EligibilityProofInputs): void {
    if (!inputs.beneficiary_commitment) throw new Error('Missing beneficiary_commitment');
    if (!inputs.nullifier) throw new Error('Missing nullifier');
    if (!inputs.position_id) throw new Error('Missing position_id');
    if (!inputs.position_commitment) throw new Error('Missing position_commitment');
    if (!inputs.identity_secret) throw new Error('Missing identity_secret');
    if (inputs.vesting_amount === undefined) throw new Error('Missing vesting_amount');
  }
}

// ============================================================================
// Proof Formatting Functions
// ============================================================================

/**
 * Convert a Barretenberg proof to Solana's on-chain format.
 *
 * Barretenberg Groth16 proofs are serialized as:
 * - 64 bytes: A point (G1, uncompressed big-endian)
 * - 128 bytes: B point (G2, uncompressed big-endian)
 * - 64 bytes: C point (G1, uncompressed big-endian)
 * Total: 256 bytes
 *
 * The on-chain verifier (Groth16Proof struct) expects the same layout.
 *
 * @param rawProof - Raw proof bytes from Barretenberg
 * @returns Formatted proof with A, B, C points separated
 */
export function formatProofForSolana(rawProof: Uint8Array): SolanaGroth16Proof {
  if (rawProof.length < 256) {
    throw new Error(
      `Invalid proof length: expected >= 256 bytes, got ${rawProof.length}. ` +
      'Ensure the Barretenberg backend is producing Groth16 proofs.'
    );
  }

  // Extract A (G1): bytes [0..64)
  const a = new Uint8Array(64);
  a.set(rawProof.slice(0, 64));

  // Extract B (G2): bytes [64..192)
  const b = new Uint8Array(128);
  b.set(rawProof.slice(64, 192));

  // Extract C (G1): bytes [192..256)
  const c = new Uint8Array(64);
  c.set(rawProof.slice(192, 256));

  return { a, b, c };
}

/**
 * Convert Noir public inputs (hex strings) to 32-byte big-endian scalars
 * for the on-chain verifier.
 *
 * Noir represents Field elements as hex strings (e.g., "0x1234...").
 * The on-chain verifier expects each public input as a [u8; 32] in big-endian.
 *
 * @param publicInputs - Array of hex string field elements from the prover
 * @returns Array of 32-byte Uint8Arrays in big-endian format
 */
export function formatPublicInputsForSolana(publicInputs: string[]): Uint8Array[] {
  return publicInputs.map((input) => {
    const value = hexToBigint(input);
    return bigintToBytes32(value);
  });
}

/**
 * Reconstruct raw proof bytes from separated A, B, C points.
 * Inverse of formatProofForSolana - used for local verification.
 *
 * @param proof - Separated proof points
 * @returns Concatenated 256-byte proof
 */
function reconstructRawProof(proof: SolanaGroth16Proof): Uint8Array {
  const raw = new Uint8Array(256);
  raw.set(proof.a, 0);
  raw.set(proof.b, 64);
  raw.set(proof.c, 192);
  return raw;
}

// ============================================================================
// Commitment and Nullifier Derivation
// ============================================================================

/**
 * Derive identity commitment from secret.
 * Matches the Noir circuit logic: `poseidon::bn254::hash_1([identity_secret])`
 *
 * @param identitySecret - The identity secret as a hex string
 * @returns The identity commitment as a 0x-prefixed hex string
 */
export async function deriveIdentityCommitment(identitySecret: string): Promise<string> {
  const secret = hexToBigint(identitySecret);
  const commitment = await poseidonHash1(secret);
  return '0x' + bigintToHex(commitment);
}

/**
 * Derive nullifier from identity secret and epoch/position ID.
 * Matches the Noir circuit logic: `poseidon::bn254::hash_2([identity_secret, id])`
 *
 * For withdrawal_proof: id = epoch_id (time-based double-spend prevention)
 * For eligibility: id = position_id (position-based double-spend prevention)
 *
 * @param identitySecret - The identity secret as a hex string
 * @param id - The epoch or position ID as a hex string
 * @returns The nullifier as a 0x-prefixed hex string
 */
export async function deriveNullifier(identitySecret: string, id: string): Promise<string> {
  const secret = hexToBigint(identitySecret);
  const idValue = hexToBigint(id);
  const nullifier = await poseidonHash2(secret, idValue);
  return '0x' + bigintToHex(nullifier);
}

/**
 * Derive withdrawal commitment from claimed amount.
 * Matches the Noir circuit logic: `poseidon::bn254::hash_1([claimed_amount as Field])`
 *
 * @param claimedAmount - The amount being claimed (u64)
 * @returns The withdrawal commitment as a 0x-prefixed hex string
 */
export async function deriveWithdrawalCommitment(claimedAmount: bigint): Promise<string> {
  const commitment = await poseidonHash1(claimedAmount);
  return '0x' + bigintToHex(commitment);
}

/**
 * Compute position leaf for the Merkle tree.
 * Matches the withdrawal circuit: `poseidon::bn254::hash_2([identity_commitment, vesting_amount])`
 *
 * This is the leaf value inserted into the state tree when a vesting position is created.
 *
 * @param identityCommitment - The identity commitment as a hex string
 * @param vestingAmount - The total vesting amount (u64)
 * @returns The position leaf as a 0x-prefixed hex string
 */
export async function computePositionLeaf(
  identityCommitment: string,
  vestingAmount: bigint
): Promise<string> {
  const idCommit = hexToBigint(identityCommitment);
  const leaf = await poseidonHash2(idCommit, vestingAmount);
  return '0x' + bigintToHex(leaf);
}

/**
 * Compute position commitment for the identity proof circuit.
 * Matches the identity circuit's tree-structured hashing:
 *
 *   left  = Poseidon(identity_commitment, encrypted_amount)
 *   right = Poseidon(start_time, cliff)
 *   mid   = Poseidon(duration, 0)
 *   inner = Poseidon(left, right)
 *   position_commitment = Poseidon(inner, mid)
 *
 * @param identityCommitment - Poseidon(identity_preimage) as hex
 * @param encryptedAmount - Encrypted vesting amount field element as hex
 * @param startTime - Vesting start timestamp as bigint
 * @param cliff - Cliff period duration as bigint
 * @param duration - Total vesting duration as bigint
 * @returns The position commitment as a 0x-prefixed hex string
 */
export async function computePositionCommitment(
  identityCommitment: string,
  encryptedAmount: string,
  startTime: bigint,
  cliff: bigint,
  duration: bigint
): Promise<string> {
  const idCommit = hexToBigint(identityCommitment);
  const amount = hexToBigint(encryptedAmount);

  const left = await poseidonHash2(idCommit, amount);
  const right = await poseidonHash2(startTime, cliff);
  const mid = await poseidonHash2(duration, 0n);
  const inner = await poseidonHash2(left, right);
  const commitment = await poseidonHash2(inner, mid);

  return '0x' + bigintToHex(commitment);
}

/**
 * Compute a Merkle root from a leaf and a 32-level proof path.
 * Matches the withdrawal circuit's compute_merkle_root function.
 *
 * In the MVP, the current node is always placed on the left at each level.
 *
 * @param leaf - The leaf value as a hex string
 * @param path - Array of 32 sibling values (hex strings)
 * @returns The computed Merkle root as a 0x-prefixed hex string
 */
export async function computeMerkleRoot(leaf: string, path: string[]): Promise<string> {
  if (path.length !== 32) {
    throw new Error('Merkle path must have exactly 32 elements');
  }

  let current = hexToBigint(leaf);
  for (let i = 0; i < 32; i++) {
    const sibling = hexToBigint(path[i]);
    current = await poseidonHash2(current, sibling);
  }

  return '0x' + bigintToHex(current);
}

// ============================================================================
// Solana Instruction Builders
// ============================================================================

/** Compute budget for proof verification (pairing is expensive) */
const VERIFY_COMPUTE_UNITS = 1_400_000;

/**
 * Compute the 8-byte Anchor instruction discriminator.
 * Anchor uses SHA-256("global:<instruction_name>") truncated to 8 bytes.
 *
 * @param instructionName - The snake_case instruction name
 * @returns 8-byte discriminator
 */
function computeDiscriminator(instructionName: string): Uint8Array {
  const hash = createHash('sha256')
    .update(`global:${instructionName}`)
    .digest();
  return new Uint8Array(hash.slice(0, 8));
}

/**
 * Compute the circuit_id for a given circuit name.
 * Uses SHA-256 of the circuit name string.
 *
 * @param circuitName - The circuit name (e.g., 'withdrawal_proof')
 * @returns 32-byte circuit_id
 */
function computeCircuitId(circuitName: string): Uint8Array {
  const hash = createHash('sha256').update(circuitName).digest();
  return new Uint8Array(hash);
}

/**
 * Derive the VK account PDA for a given circuit.
 *
 * PDA Seeds: [b"vk", circuit_id]
 *
 * @param programId - The ShadowVest program ID
 * @param circuitName - The circuit name
 * @returns The VK account public key
 */
export function deriveVkAccountPda(
  programId: PublicKey,
  circuitName: string
): PublicKey {
  const circuitId = computeCircuitId(circuitName);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vk'), Buffer.from(circuitId)],
    programId
  );
  return pda;
}

/**
 * Derive the proof record PDA.
 *
 * PDA Seeds: [b"proof_record", verifier, nullifier_bytes]
 *
 * @param programId - The ShadowVest program ID
 * @param verifier - The verifier public key
 * @param nullifierBytes - The 32-byte nullifier (or position_commitment for identity proofs)
 * @returns The proof record PDA and bump
 */
function deriveProofRecordPda(
  programId: PublicKey,
  verifier: PublicKey,
  nullifierBytes: Uint8Array
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('proof_record'),
      verifier.toBuffer(),
      Buffer.from(nullifierBytes),
    ],
    programId
  );
  return pda;
}

/**
 * Serialize a Groth16Proof into Anchor-compatible bytes.
 * Layout: a(64) || b(128) || c(64) = 256 bytes total.
 */
function serializeGroth16Proof(proof: SolanaGroth16Proof): Buffer {
  const buf = Buffer.alloc(256);
  buf.set(proof.a, 0);
  buf.set(proof.b, 64);
  buf.set(proof.c, 192);
  return buf;
}

/**
 * Serialize WithdrawalPublicInputs into Anchor-compatible bytes.
 * Layout: state_root(32) || epoch_id(8 LE) || nullifier(32) || withdrawal_commitment(32)
 */
function serializeWithdrawalPublicInputs(publicInputs: Uint8Array[]): Buffer {
  // public inputs order: state_root, epoch_id, nullifier, withdrawal_commitment
  const buf = Buffer.alloc(104); // 32 + 8 + 32 + 32
  buf.set(publicInputs[0], 0); // state_root (32 bytes)

  // epoch_id: convert from 32-byte BE scalar to u64 LE
  const epochBigint = bytes32ToBigint(publicInputs[1]);
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigUInt64LE(epochBigint);
  buf.set(epochBuf, 32);

  buf.set(publicInputs[2], 40); // nullifier (32 bytes)
  buf.set(publicInputs[3], 72); // withdrawal_commitment (32 bytes)
  return buf;
}

/**
 * Serialize IdentityPublicInputs into Anchor-compatible bytes.
 * Layout: position_commitment(32)
 */
function serializeIdentityPublicInputs(publicInputs: Uint8Array[]): Buffer {
  const buf = Buffer.alloc(32);
  buf.set(publicInputs[0], 0);
  return buf;
}

/**
 * Serialize EligibilityPublicInputs into Anchor-compatible bytes.
 * Layout: beneficiary_commitment(32) || nullifier(32) || position_id(32) || position_commitment(32)
 */
function serializeEligibilityPublicInputs(publicInputs: Uint8Array[]): Buffer {
  const buf = Buffer.alloc(128);
  buf.set(publicInputs[0], 0);   // beneficiary_commitment
  buf.set(publicInputs[1], 32);  // nullifier
  buf.set(publicInputs[2], 64);  // position_id
  buf.set(publicInputs[3], 96);  // position_commitment
  return buf;
}

/**
 * Build a Solana transaction instruction for verify_withdrawal_proof.
 *
 * Encodes the proof and public inputs in the format expected by the on-chain
 * program, and includes a compute budget instruction.
 *
 * Accounts:
 * 1. verifier (signer, mutable) - pays for proof record
 * 2. vk_account - verification key PDA for withdrawal circuit
 * 3. proof_record (init) - PDA to store verification attestation
 * 4. system_program
 *
 * @param programId - The ShadowVest program ID
 * @param verifier - The verifier/payer public key
 * @param vkAccount - The verification key account for the withdrawal circuit
 * @param proof - The proof result from generateWithdrawalProof
 * @returns The transaction instruction and derived proof record PDA
 */
export function buildVerifyWithdrawalIx(
  programId: PublicKey,
  verifier: PublicKey,
  vkAccount: PublicKey,
  proof: ProofResult,
): { instruction: TransactionInstruction; proofRecordPda: PublicKey; computeBudgetIx: TransactionInstruction } {
  // The nullifier is the 3rd public input (index 2): state_root, epoch_id, nullifier, ...
  const nullifierBytes = proof.publicInputs[2];
  const proofRecordPda = deriveProofRecordPda(programId, verifier, nullifierBytes);

  const discriminator = computeDiscriminator('verify_withdrawal_proof');
  const proofData = serializeGroth16Proof(proof.proof);
  const publicInputsData = serializeWithdrawalPublicInputs(proof.publicInputs);

  const data = Buffer.concat([
    Buffer.from(discriminator),
    proofData,
    publicInputsData,
  ]);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: verifier, isSigner: true, isWritable: true },
      { pubkey: vkAccount, isSigner: false, isWritable: false },
      { pubkey: proofRecordPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: VERIFY_COMPUTE_UNITS,
  });

  return { instruction, proofRecordPda, computeBudgetIx };
}

/**
 * Build a Solana transaction instruction for verify_identity_proof.
 *
 * For identity proofs, the proof record PDA uses position_commitment
 * as the nullifier (since there is no explicit nullifier in this circuit).
 *
 * @param programId - The ShadowVest program ID
 * @param verifier - The verifier/payer public key
 * @param vkAccount - The verification key account for the identity circuit
 * @param proof - The proof result from generateIdentityProof
 * @returns The transaction instruction and derived proof record PDA
 */
export function buildVerifyIdentityIx(
  programId: PublicKey,
  verifier: PublicKey,
  vkAccount: PublicKey,
  proof: ProofResult,
): { instruction: TransactionInstruction; proofRecordPda: PublicKey; computeBudgetIx: TransactionInstruction } {
  // The position_commitment is the 1st (only) public input
  const positionCommitmentBytes = proof.publicInputs[0];
  const proofRecordPda = deriveProofRecordPda(programId, verifier, positionCommitmentBytes);

  const discriminator = computeDiscriminator('verify_identity_proof');
  const proofData = serializeGroth16Proof(proof.proof);
  const publicInputsData = serializeIdentityPublicInputs(proof.publicInputs);

  const data = Buffer.concat([
    Buffer.from(discriminator),
    proofData,
    publicInputsData,
  ]);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: verifier, isSigner: true, isWritable: true },
      { pubkey: vkAccount, isSigner: false, isWritable: false },
      { pubkey: proofRecordPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: VERIFY_COMPUTE_UNITS,
  });

  return { instruction, proofRecordPda, computeBudgetIx };
}

/**
 * Build a Solana transaction instruction for verify_eligibility_proof.
 *
 * @param programId - The ShadowVest program ID
 * @param verifier - The verifier/payer public key
 * @param vkAccount - The verification key account for the eligibility circuit
 * @param proof - The proof result from generateEligibilityProof
 * @returns The transaction instruction and derived proof record PDA
 */
export function buildVerifyEligibilityIx(
  programId: PublicKey,
  verifier: PublicKey,
  vkAccount: PublicKey,
  proof: ProofResult,
): { instruction: TransactionInstruction; proofRecordPda: PublicKey; computeBudgetIx: TransactionInstruction } {
  // The nullifier is the 2nd public input (index 1): beneficiary_commitment, nullifier, ...
  const nullifierBytes = proof.publicInputs[1];
  const proofRecordPda = deriveProofRecordPda(programId, verifier, nullifierBytes);

  const discriminator = computeDiscriminator('verify_eligibility_proof');
  const proofData = serializeGroth16Proof(proof.proof);
  const publicInputsData = serializeEligibilityPublicInputs(proof.publicInputs);

  const data = Buffer.concat([
    Buffer.from(discriminator),
    proofData,
    publicInputsData,
  ]);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: verifier, isSigner: true, isWritable: true },
      { pubkey: vkAccount, isSigner: false, isWritable: false },
      { pubkey: proofRecordPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: VERIFY_COMPUTE_UNITS,
  });

  return { instruction, proofRecordPda, computeBudgetIx };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Normalize a hex field value to the format NoirJS expects.
 * Ensures 0x prefix and proper padding.
 *
 * @param hex - Hex string with or without 0x prefix
 * @returns Properly formatted hex string for NoirJS
 */
function normalizeHexField(hex: string): string {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  // Noir expects 0x-prefixed hex strings for Field inputs
  return '0x' + cleaned.padStart(64, '0');
}
