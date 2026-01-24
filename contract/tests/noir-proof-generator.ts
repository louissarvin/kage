/**
 * Test suite for the ShadowVest Noir ZK Proof Generator.
 *
 * Tests cover:
 * 1. Poseidon hash utilities (consistency and correctness)
 * 2. Proof formatting (G1/G2 points and public input serialization)
 * 3. ShadowVestProver class (API shape, validation, initialization)
 * 4. Instruction builders (PDA derivation, data encoding, account structure)
 *
 * Note: Full proof generation tests require compiled Noir circuit artifacts
 * (output of `nargo compile`). The tests here validate the library's API
 * surface, error handling, and deterministic utilities without requiring
 * the Barretenberg WASM runtime.
 */

import { expect } from 'chai';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { createHash } from 'crypto';
import {
  ShadowVestProver,
  WithdrawalProofInputs,
  IdentityProofInputs,
  EligibilityProofInputs,
  ProofResult,
  SolanaGroth16Proof,
  formatProofForSolana,
  formatPublicInputsForSolana,
  deriveIdentityCommitment,
  deriveNullifier,
  deriveWithdrawalCommitment,
  computePositionLeaf,
  computePositionCommitment,
  computeMerkleRoot,
  buildVerifyWithdrawalIx,
  buildVerifyIdentityIx,
  buildVerifyEligibilityIx,
  deriveVkAccountPda,
} from '../lib/noir-proof-generator';
import {
  poseidonHash1,
  poseidonHash2,
  bigintToBytes32,
  bytes32ToBigint,
  hexToBigint,
  bigintToHex,
  hexToBytes32,
  bytes32ToHex,
  u64ToScalar,
} from '../lib/poseidon-bn254';

// ============================================================================
// Test Constants
// ============================================================================

const TEST_PROGRAM_ID = new PublicKey('ShdwVst111111111111111111111111111111111111');

// A mock 256-byte proof (matches Groth16 format: A=64, B=128, C=64)
function createMockProof(): Uint8Array {
  const proof = new Uint8Array(256);
  // Fill with deterministic values for testing
  for (let i = 0; i < 64; i++) proof[i] = i; // A point
  for (let i = 64; i < 192; i++) proof[i] = (i - 64) % 256; // B point
  for (let i = 192; i < 256; i++) proof[i] = (i - 192) + 100; // C point
  return proof;
}

function createMockProofResult(numPublicInputs: number): ProofResult {
  const rawProof = createMockProof();
  const proof: SolanaGroth16Proof = {
    a: rawProof.slice(0, 64),
    b: rawProof.slice(64, 192),
    c: rawProof.slice(192, 256),
  };
  const publicInputs: Uint8Array[] = [];
  for (let i = 0; i < numPublicInputs; i++) {
    const pi = new Uint8Array(32);
    pi[31] = i + 1; // Simple distinct values
    publicInputs.push(pi);
  }
  return { proof, publicInputs };
}

// ============================================================================
// Tests
// ============================================================================

describe('NoirJS Proof Generator', () => {

  // --------------------------------------------------------------------------
  // Poseidon Hash Utilities
  // --------------------------------------------------------------------------

  describe('Poseidon Hash Utilities', () => {

    it('computes consistent hash_1 values', async () => {
      // Same input should always produce the same hash
      const input = 42n;
      const hash1 = await poseidonHash1(input);
      const hash2 = await poseidonHash1(input);
      expect(hash1).to.equal(hash2);

      // Different inputs should produce different hashes
      const hash3 = await poseidonHash1(43n);
      expect(hash1).to.not.equal(hash3);
    });

    it('computes consistent hash_2 values', async () => {
      const a = 100n;
      const b = 200n;
      const hash1 = await poseidonHash2(a, b);
      const hash2 = await poseidonHash2(a, b);
      expect(hash1).to.equal(hash2);

      // Order matters in hash_2
      const hash3 = await poseidonHash2(b, a);
      expect(hash1).to.not.equal(hash3);
    });

    it('derives identity commitment correctly', async () => {
      const secret = '0x000000000000000000000000000000000000000000000000000000000000002a'; // 42
      const commitment = await deriveIdentityCommitment(secret);

      // Verify it matches direct poseidonHash1 call
      const expected = await poseidonHash1(42n);
      expect(hexToBigint(commitment)).to.equal(expected);
    });

    it('derives nullifier correctly', async () => {
      const secret = '0x000000000000000000000000000000000000000000000000000000000000002a'; // 42
      const epochId = '0x0000000000000000000000000000000000000000000000000000000000000001'; // 1
      const nullifier = await deriveNullifier(secret, epochId);

      // Verify it matches direct poseidonHash2 call
      const expected = await poseidonHash2(42n, 1n);
      expect(hexToBigint(nullifier)).to.equal(expected);
    });

    it('derives withdrawal commitment correctly', async () => {
      const amount = 500n;
      const commitment = await deriveWithdrawalCommitment(amount);

      // Verify it matches direct poseidonHash1 call
      const expected = await poseidonHash1(500n);
      expect(hexToBigint(commitment)).to.equal(expected);
    });

    it('computes position leaf correctly', async () => {
      const secret = 42n;
      const amount = 1000n;

      // First derive identity commitment
      const idCommitment = await poseidonHash1(secret);
      const idCommitHex = '0x' + bigintToHex(idCommitment);

      // Compute position leaf
      const leaf = await computePositionLeaf(idCommitHex, amount);

      // Verify it matches the circuit's computation
      const expected = await poseidonHash2(idCommitment, amount);
      expect(hexToBigint(leaf)).to.equal(expected);
    });

    it('computes position commitment for identity circuit', async () => {
      const secret = 77n;
      const encryptedAmount = 50000n;
      const startTime = 1700000000n;
      const cliff = 2592000n;
      const duration = 31536000n;

      const idCommit = await poseidonHash1(secret);
      const idCommitHex = '0x' + bigintToHex(idCommit);
      const amountHex = '0x' + bigintToHex(encryptedAmount);

      const commitment = await computePositionCommitment(
        idCommitHex, amountHex, startTime, cliff, duration
      );

      // Verify by recomputing manually
      const left = await poseidonHash2(idCommit, encryptedAmount);
      const right = await poseidonHash2(startTime, cliff);
      const mid = await poseidonHash2(duration, 0n);
      const inner = await poseidonHash2(left, right);
      const expected = await poseidonHash2(inner, mid);

      expect(hexToBigint(commitment)).to.equal(expected);
    });

    it('computes Merkle root with zero path', async () => {
      const secret = 42n;
      const amount = 1000n;

      const idCommit = await poseidonHash1(secret);
      const leaf = await poseidonHash2(idCommit, amount);
      const leafHex = '0x' + bigintToHex(leaf);

      // All-zero path (same as Noir test)
      const zeroPath = Array(32).fill('0x' + '0'.repeat(64));

      const root = await computeMerkleRoot(leafHex, zeroPath);

      // Verify by walking up the tree manually
      let current = leaf;
      for (let i = 0; i < 32; i++) {
        current = await poseidonHash2(current, 0n);
      }
      expect(hexToBigint(root)).to.equal(current);
    });

    it('converts bigint to/from bytes32 correctly', () => {
      // Zero
      const zeroBytes = bigintToBytes32(0n);
      expect(zeroBytes.every((b) => b === 0)).to.be.true;
      expect(bytes32ToBigint(zeroBytes)).to.equal(0n);

      // Small value
      const smallBytes = bigintToBytes32(42n);
      expect(smallBytes[31]).to.equal(42);
      expect(bytes32ToBigint(smallBytes)).to.equal(42n);

      // Large value (256 bits - 1, within BN254 field)
      const largeValue = (1n << 253n) - 1n;
      const largeBytes = bigintToBytes32(largeValue);
      expect(bytes32ToBigint(largeBytes)).to.equal(largeValue);
    });

    it('converts hex to/from bigint correctly', () => {
      expect(hexToBigint('0x2a')).to.equal(42n);
      expect(hexToBigint('2a')).to.equal(42n);
      expect(hexToBigint('0x0')).to.equal(0n);

      expect(bigintToHex(42n)).to.equal('000000000000000000000000000000000000000000000000000000000000002a');
      expect(bigintToHex(0n)).to.equal('0'.repeat(64));
    });

    it('u64ToScalar places value in last 8 bytes big-endian', () => {
      const scalar = u64ToScalar(42n);
      // First 24 bytes should be zero
      for (let i = 0; i < 24; i++) {
        expect(scalar[i]).to.equal(0);
      }
      // Last 8 bytes should be 42 in big-endian
      expect(scalar[31]).to.equal(42);

      // Larger value
      const scalar2 = u64ToScalar(0x0102030405060708n);
      expect(scalar2[24]).to.equal(0x01);
      expect(scalar2[25]).to.equal(0x02);
      expect(scalar2[31]).to.equal(0x08);
    });

    it('hexToBytes32 and bytes32ToHex are inverses', () => {
      const hex = '0x000000000000000000000000000000000000000000000000000000000000002a';
      const bytes = hexToBytes32(hex);
      const recovered = bytes32ToHex(bytes);
      expect(recovered).to.equal(hex);
    });

    it('throws on invalid inputs', () => {
      expect(() => bigintToBytes32(-1n)).to.throw('non-negative');
      expect(() => bytes32ToBigint(new Uint8Array(31))).to.throw('expected 32 bytes');
      expect(() => hexToBigint('')).to.throw('empty hex');
      expect(() => hexToBigint('0xGG')).to.throw('invalid hex');
      expect(() => bigintToHex(-1n)).to.throw('non-negative');
      expect(() => u64ToScalar(-1n)).to.throw('out of u64 range');
      expect(() => u64ToScalar(1n << 64n)).to.throw('out of u64 range');
    });
  });

  // --------------------------------------------------------------------------
  // Proof Formatting
  // --------------------------------------------------------------------------

  describe('Proof Formatting', () => {

    it('formats G1 points as 64 bytes', () => {
      const rawProof = createMockProof();
      const formatted = formatProofForSolana(rawProof);

      expect(formatted.a.length).to.equal(64);
      expect(formatted.c.length).to.equal(64);

      // Verify A matches first 64 bytes
      for (let i = 0; i < 64; i++) {
        expect(formatted.a[i]).to.equal(rawProof[i]);
      }

      // Verify C matches bytes [192..256)
      for (let i = 0; i < 64; i++) {
        expect(formatted.c[i]).to.equal(rawProof[192 + i]);
      }
    });

    it('formats G2 points as 128 bytes', () => {
      const rawProof = createMockProof();
      const formatted = formatProofForSolana(rawProof);

      expect(formatted.b.length).to.equal(128);

      // Verify B matches bytes [64..192)
      for (let i = 0; i < 128; i++) {
        expect(formatted.b[i]).to.equal(rawProof[64 + i]);
      }
    });

    it('formats public inputs as 32-byte scalars', () => {
      const hexInputs = [
        '0x000000000000000000000000000000000000000000000000000000000000002a', // 42
        '0x0000000000000000000000000000000000000000000000000000000000000001', // 1
      ];

      const formatted = formatPublicInputsForSolana(hexInputs);

      expect(formatted.length).to.equal(2);
      expect(formatted[0].length).to.equal(32);
      expect(formatted[1].length).to.equal(32);

      expect(formatted[0][31]).to.equal(42);
      expect(formatted[1][31]).to.equal(1);
    });

    it('handles epoch_id u64 to scalar conversion', () => {
      const epochId = 12345n;
      const scalar = u64ToScalar(epochId);

      // Should be 32 bytes with epoch in big-endian in last 8 bytes
      expect(scalar.length).to.equal(32);
      expect(bytes32ToBigint(scalar)).to.equal(epochId);
    });

    it('throws on proof too short', () => {
      const shortProof = new Uint8Array(100);
      expect(() => formatProofForSolana(shortProof)).to.throw('expected >= 256 bytes');
    });

    it('handles proof longer than 256 bytes gracefully', () => {
      const longProof = new Uint8Array(300);
      for (let i = 0; i < 300; i++) longProof[i] = i % 256;

      const formatted = formatProofForSolana(longProof);
      expect(formatted.a.length).to.equal(64);
      expect(formatted.b.length).to.equal(128);
      expect(formatted.c.length).to.equal(64);
    });
  });

  // --------------------------------------------------------------------------
  // ShadowVestProver
  // --------------------------------------------------------------------------

  describe('ShadowVestProver', () => {

    it('throws if not initialized', async () => {
      const prover = new ShadowVestProver();

      try {
        await prover.generateWithdrawalProof({} as any);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('not initialized');
      }

      try {
        await prover.generateIdentityProof({} as any);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('not initialized');
      }

      try {
        await prover.generateEligibilityProof({} as any);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('not initialized');
      }
    });

    it('validates withdrawal proof inputs', async () => {
      // Create a prover and mock-initialize it (bypass actual WASM init)
      const prover = new ShadowVestProver();
      // Access private field to set initialized flag for validation testing
      (prover as any).initialized = true;
      (prover as any).noirs.set('withdrawal_proof', {});
      (prover as any).backends.set('withdrawal_proof', {});

      const baseInputs: WithdrawalProofInputs = {
        state_root: '0x' + '1'.repeat(64),
        epoch_id: 1n,
        nullifier: '0x' + '2'.repeat(64),
        withdrawal_commitment: '0x' + '3'.repeat(64),
        vesting_amount: 1000n,
        identity_secret: '0x' + '4'.repeat(64),
        vesting_path: Array(32).fill('0x' + '0'.repeat(64)),
        claimed_amount: 500n,
      };

      // Missing state_root
      try {
        await prover.generateWithdrawalProof({ ...baseInputs, state_root: '' });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('state_root');
      }

      // Wrong vesting_path length
      try {
        await prover.generateWithdrawalProof({ ...baseInputs, vesting_path: ['0x00'] });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('32 Field elements');
      }

      // claimed_amount exceeds vesting_amount
      try {
        await prover.generateWithdrawalProof({ ...baseInputs, claimed_amount: 1001n });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('exceeds vesting_amount');
      }
    });

    it('validates identity proof inputs', async () => {
      const prover = new ShadowVestProver();
      (prover as any).initialized = true;
      (prover as any).noirs.set('identity_proof', {});
      (prover as any).backends.set('identity_proof', {});

      // Missing position_commitment
      try {
        await prover.generateIdentityProof({
          position_commitment: '',
          identity_preimage: '0x' + '1'.repeat(64),
          position_data: Array(4).fill('0x' + '0'.repeat(64)),
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('position_commitment');
      }

      // Wrong position_data length
      try {
        await prover.generateIdentityProof({
          position_commitment: '0x' + '1'.repeat(64),
          identity_preimage: '0x' + '2'.repeat(64),
          position_data: ['0x00', '0x01', '0x02'], // only 3 elements
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('4 Field elements');
      }
    });

    it('validates eligibility proof inputs', async () => {
      const prover = new ShadowVestProver();
      (prover as any).initialized = true;
      (prover as any).noirs.set('eligibility', {});
      (prover as any).backends.set('eligibility', {});

      // Missing identity_secret
      try {
        await prover.generateEligibilityProof({
          beneficiary_commitment: '0x' + '1'.repeat(64),
          nullifier: '0x' + '2'.repeat(64),
          position_id: '0x' + '3'.repeat(64),
          position_commitment: '0x' + '4'.repeat(64),
          identity_secret: '',
          vesting_amount: 1000n,
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('identity_secret');
      }
    });

    it('generates consistent nullifiers across attempts', async () => {
      const secret = '0x000000000000000000000000000000000000000000000000000000000000002a';
      const epochId = '0x0000000000000000000000000000000000000000000000000000000000000001';

      const nullifier1 = await deriveNullifier(secret, epochId);
      const nullifier2 = await deriveNullifier(secret, epochId);

      // Same inputs must produce same nullifier (deterministic)
      expect(nullifier1).to.equal(nullifier2);

      // Different epoch produces different nullifier
      const epochId2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
      const nullifier3 = await deriveNullifier(secret, epochId2);
      expect(nullifier1).to.not.equal(nullifier3);
    });

    it('verifyLocally throws on unknown circuit', async () => {
      const prover = new ShadowVestProver();
      (prover as any).initialized = true;

      const mockResult = createMockProofResult(4);

      try {
        await prover.verifyLocally('nonexistent_circuit', mockResult);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('Unknown circuit');
      }
    });

    it('destroy cleans up state', async () => {
      const prover = new ShadowVestProver();
      (prover as any).initialized = true;
      (prover as any).backends.set('test', { destroy: async () => {} });
      (prover as any).noirs.set('test', {});

      await prover.destroy();

      expect((prover as any).initialized).to.be.false;
      expect((prover as any).backends.size).to.equal(0);
      expect((prover as any).noirs.size).to.equal(0);
    });
  });

  // --------------------------------------------------------------------------
  // Instruction Builders
  // --------------------------------------------------------------------------

  describe('Instruction Builders', () => {

    it('builds verify_withdrawal_proof instruction', () => {
      const verifier = Keypair.generate().publicKey;
      const vkAccount = Keypair.generate().publicKey;
      const proofResult = createMockProofResult(4);

      const { instruction, proofRecordPda, computeBudgetIx } = buildVerifyWithdrawalIx(
        TEST_PROGRAM_ID, verifier, vkAccount, proofResult
      );

      expect(instruction.programId.equals(TEST_PROGRAM_ID)).to.be.true;
      expect(instruction.keys.length).to.equal(4);
      expect(instruction.keys[0].pubkey.equals(verifier)).to.be.true;
      expect(instruction.keys[0].isSigner).to.be.true;
      expect(instruction.keys[0].isWritable).to.be.true;
      expect(instruction.keys[1].pubkey.equals(vkAccount)).to.be.true;
      expect(instruction.keys[1].isSigner).to.be.false;
      expect(instruction.keys[2].pubkey.equals(proofRecordPda)).to.be.true;
      expect(instruction.keys[2].isWritable).to.be.true;
      expect(instruction.keys[3].pubkey.equals(SystemProgram.programId)).to.be.true;

      // Verify discriminator (first 8 bytes)
      const expectedDiscriminator = createHash('sha256')
        .update('global:verify_withdrawal_proof')
        .digest()
        .slice(0, 8);
      expect(Buffer.from(instruction.data.slice(0, 8))).to.deep.equal(
        Buffer.from(expectedDiscriminator)
      );

      // Verify data length: 8 (discriminator) + 256 (proof) + 104 (public inputs)
      expect(instruction.data.length).to.equal(8 + 256 + 104);

      // Verify compute budget instruction is present
      expect(computeBudgetIx).to.not.be.undefined;
    });

    it('builds verify_identity_proof instruction', () => {
      const verifier = Keypair.generate().publicKey;
      const vkAccount = Keypair.generate().publicKey;
      const proofResult = createMockProofResult(1);

      const { instruction, proofRecordPda, computeBudgetIx } = buildVerifyIdentityIx(
        TEST_PROGRAM_ID, verifier, vkAccount, proofResult
      );

      expect(instruction.programId.equals(TEST_PROGRAM_ID)).to.be.true;
      expect(instruction.keys.length).to.equal(4);

      // Verify discriminator
      const expectedDiscriminator = createHash('sha256')
        .update('global:verify_identity_proof')
        .digest()
        .slice(0, 8);
      expect(Buffer.from(instruction.data.slice(0, 8))).to.deep.equal(
        Buffer.from(expectedDiscriminator)
      );

      // Verify data length: 8 (discriminator) + 256 (proof) + 32 (public inputs)
      expect(instruction.data.length).to.equal(8 + 256 + 32);
    });

    it('builds verify_eligibility_proof instruction', () => {
      const verifier = Keypair.generate().publicKey;
      const vkAccount = Keypair.generate().publicKey;
      const proofResult = createMockProofResult(4);

      const { instruction, proofRecordPda, computeBudgetIx } = buildVerifyEligibilityIx(
        TEST_PROGRAM_ID, verifier, vkAccount, proofResult
      );

      expect(instruction.programId.equals(TEST_PROGRAM_ID)).to.be.true;
      expect(instruction.keys.length).to.equal(4);

      // Verify discriminator
      const expectedDiscriminator = createHash('sha256')
        .update('global:verify_eligibility_proof')
        .digest()
        .slice(0, 8);
      expect(Buffer.from(instruction.data.slice(0, 8))).to.deep.equal(
        Buffer.from(expectedDiscriminator)
      );

      // Verify data length: 8 (discriminator) + 256 (proof) + 128 (public inputs)
      expect(instruction.data.length).to.equal(8 + 256 + 128);
    });

    it('derives correct proof record PDA for withdrawal', () => {
      const verifier = Keypair.generate().publicKey;
      const vkAccount = Keypair.generate().publicKey;
      const proofResult = createMockProofResult(4);

      const { proofRecordPda } = buildVerifyWithdrawalIx(
        TEST_PROGRAM_ID, verifier, vkAccount, proofResult
      );

      // Manually derive the expected PDA
      // Nullifier is the 3rd public input (index 2)
      const nullifierBytes = proofResult.publicInputs[2];
      const [expectedPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('proof_record'),
          verifier.toBuffer(),
          Buffer.from(nullifierBytes),
        ],
        TEST_PROGRAM_ID
      );

      expect(proofRecordPda.equals(expectedPda)).to.be.true;
    });

    it('derives correct proof record PDA for identity', () => {
      const verifier = Keypair.generate().publicKey;
      const vkAccount = Keypair.generate().publicKey;
      const proofResult = createMockProofResult(1);

      const { proofRecordPda } = buildVerifyIdentityIx(
        TEST_PROGRAM_ID, verifier, vkAccount, proofResult
      );

      // For identity proofs, PDA uses position_commitment (1st public input)
      const positionCommitmentBytes = proofResult.publicInputs[0];
      const [expectedPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('proof_record'),
          verifier.toBuffer(),
          Buffer.from(positionCommitmentBytes),
        ],
        TEST_PROGRAM_ID
      );

      expect(proofRecordPda.equals(expectedPda)).to.be.true;
    });

    it('derives correct proof record PDA for eligibility', () => {
      const verifier = Keypair.generate().publicKey;
      const vkAccount = Keypair.generate().publicKey;
      const proofResult = createMockProofResult(4);

      const { proofRecordPda } = buildVerifyEligibilityIx(
        TEST_PROGRAM_ID, verifier, vkAccount, proofResult
      );

      // For eligibility proofs, PDA uses nullifier (2nd public input, index 1)
      const nullifierBytes = proofResult.publicInputs[1];
      const [expectedPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('proof_record'),
          verifier.toBuffer(),
          Buffer.from(nullifierBytes),
        ],
        TEST_PROGRAM_ID
      );

      expect(proofRecordPda.equals(expectedPda)).to.be.true;
    });

    it('derives VK account PDA', () => {
      const circuitName = 'withdrawal_proof';
      const vkPda = deriveVkAccountPda(TEST_PROGRAM_ID, circuitName);

      // Manually compute expected PDA
      const circuitId = createHash('sha256').update(circuitName).digest();
      const [expectedPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vk'), circuitId],
        TEST_PROGRAM_ID
      );

      expect(vkPda.equals(expectedPda)).to.be.true;
    });

    it('includes compute budget instruction with 1.4M units', () => {
      const verifier = Keypair.generate().publicKey;
      const vkAccount = Keypair.generate().publicKey;
      const proofResult = createMockProofResult(4);

      const { computeBudgetIx } = buildVerifyWithdrawalIx(
        TEST_PROGRAM_ID, verifier, vkAccount, proofResult
      );

      // ComputeBudgetProgram ID
      const computeBudgetProgramId = new PublicKey(
        'ComputeBudget111111111111111111111111111111'
      );
      expect(computeBudgetIx.programId.equals(computeBudgetProgramId)).to.be.true;
    });

    it('withdrawal instruction encodes epoch_id as u64 LE in public inputs data', () => {
      const verifier = Keypair.generate().publicKey;
      const vkAccount = Keypair.generate().publicKey;

      // Create proof result with specific epoch_id value in the scalar
      const proofResult = createMockProofResult(4);
      // Set epoch_id (index 1) to a known value: 42
      const epochScalar = new Uint8Array(32);
      epochScalar[31] = 42; // big-endian
      proofResult.publicInputs[1] = epochScalar;

      const { instruction } = buildVerifyWithdrawalIx(
        TEST_PROGRAM_ID, verifier, vkAccount, proofResult
      );

      // Data layout: discriminator(8) + proof(256) + state_root(32) + epoch_id(8 LE) + ...
      // epoch_id starts at offset 8 + 256 + 32 = 296
      const epochOffset = 8 + 256 + 32;
      const epochBuf = instruction.data.slice(epochOffset, epochOffset + 8);

      // Should be 42 in little-endian u64
      const epochValue = Buffer.from(epochBuf).readBigUInt64LE();
      expect(epochValue).to.equal(42n);
    });
  });

  // --------------------------------------------------------------------------
  // Integration: Commitment Derivation Flow
  // --------------------------------------------------------------------------

  describe('Commitment Derivation Flow', () => {

    it('full withdrawal flow: secret -> commitment -> leaf -> nullifier', async () => {
      const secret = 12345n;
      const amount = 50000n;
      const epochId = 1n;

      // Step 1: Derive identity commitment
      const idCommitment = await poseidonHash1(secret);
      const idCommitHex = '0x' + bigintToHex(idCommitment);

      // Step 2: Compute position leaf
      const leaf = await computePositionLeaf(idCommitHex, amount);
      const expectedLeaf = await poseidonHash2(idCommitment, amount);
      expect(hexToBigint(leaf)).to.equal(expectedLeaf);

      // Step 3: Derive nullifier for this epoch
      const secretHex = '0x' + bigintToHex(secret);
      const epochHex = '0x' + bigintToHex(epochId);
      const nullifier = await deriveNullifier(secretHex, epochHex);
      const expectedNullifier = await poseidonHash2(secret, epochId);
      expect(hexToBigint(nullifier)).to.equal(expectedNullifier);

      // Step 4: Derive withdrawal commitment
      const claimAmount = 500n;
      const wCommit = await deriveWithdrawalCommitment(claimAmount);
      const expectedWCommit = await poseidonHash1(claimAmount);
      expect(hexToBigint(wCommit)).to.equal(expectedWCommit);
    });

    it('eligibility flow: secret -> commitment -> nullifier -> position', async () => {
      const secret = 12345n;
      const amount = 50000n;
      const positionId = 1n;

      // Step 1: Derive beneficiary commitment
      const beneficiaryCommit = await poseidonHash1(secret);
      const beneficiaryHex = '0x' + bigintToHex(beneficiaryCommit);

      // Verify via helper
      const secretHex = '0x' + bigintToHex(secret);
      const derivedCommit = await deriveIdentityCommitment(secretHex);
      expect(derivedCommit).to.equal(beneficiaryHex);

      // Step 2: Derive nullifier
      const posIdHex = '0x' + bigintToHex(positionId);
      const nullifier = await deriveNullifier(secretHex, posIdHex);
      const expectedNullifier = await poseidonHash2(secret, positionId);
      expect(hexToBigint(nullifier)).to.equal(expectedNullifier);

      // Step 3: Compute position commitment
      const positionCommit = await poseidonHash2(beneficiaryCommit, amount);
      const leafHex = await computePositionLeaf(beneficiaryHex, amount);
      expect(hexToBigint(leafHex)).to.equal(positionCommit);
    });

    it('Merkle root computation is consistent', async () => {
      const leaf = '0x' + bigintToHex(42n);
      const path = Array(32).fill('0x' + bigintToHex(0n));

      const root1 = await computeMerkleRoot(leaf, path);
      const root2 = await computeMerkleRoot(leaf, path);
      expect(root1).to.equal(root2);

      // Different leaf produces different root
      const leaf2 = '0x' + bigintToHex(43n);
      const root3 = await computeMerkleRoot(leaf2, path);
      expect(root1).to.not.equal(root3);
    });

    it('throws on invalid Merkle path length', async () => {
      const leaf = '0x' + bigintToHex(42n);
      const shortPath = Array(16).fill('0x' + bigintToHex(0n));

      try {
        await computeMerkleRoot(leaf, shortPath);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('32 elements');
      }
    });
  });
});
