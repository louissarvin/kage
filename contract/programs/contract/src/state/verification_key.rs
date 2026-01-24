use anchor_lang::prelude::*;

/// On-chain account storing a Groth16 verification key for a specific Noir circuit.
///
/// Each circuit (withdrawal_proof, identity_proof, eligibility) has its own VK
/// derived from the trusted setup ceremony. The VK is stored on-chain so that
/// proof verification can reference it without passing it as instruction data.
///
/// PDA Seeds: [b"vk", circuit_id]
/// Where circuit_id is a 32-byte identifier (e.g., SHA-256 of circuit name).
#[account]
pub struct VerificationKeyAccount {
    /// Authority that can update or deactivate this VK (typically the DAO admin)
    pub authority: Pubkey,
    /// Unique identifier for which circuit this VK belongs to.
    /// Derived as: sha256("withdrawal_proof"), sha256("identity_proof"), etc.
    pub circuit_id: [u8; 32],
    /// Serialized VerificationKey data (AnchorSerialize format).
    /// Contains alpha_g1, beta_g2, gamma_g2, delta_g2, and IC points.
    /// Variable length due to IC vector.
    pub vk_data: Vec<u8>,
    /// Whether this VK is active and can be used for verification
    pub is_active: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl VerificationKeyAccount {
    /// Base size (without vk_data vector contents):
    /// discriminator + authority + circuit_id + vec_len + is_active + bump
    pub const BASE_SIZE: usize = 8 + // discriminator
        32 + // authority
        32 + // circuit_id
        4 +  // vec length prefix (u32)
        1 +  // is_active
        1;   // bump
    // Total base: 78 bytes

    /// PDA seed prefix
    pub const SEED_PREFIX: &'static [u8] = b"vk";

    /// Calculate the required account size for a given VK data length
    pub fn size_with_vk_data(vk_data_len: usize) -> usize {
        Self::BASE_SIZE + vk_data_len
    }

    /// Maximum supported VK data size.
    /// With 5 IC points (4 public inputs + 1):
    /// alpha_g1(64) + beta_g2(128) + gamma_g2(128) + delta_g2(128) + vec_len(4) + 5*ic(320)
    /// = 772 bytes serialized
    /// Allow headroom for larger circuits.
    pub const MAX_VK_DATA_SIZE: usize = 2048;
}

/// Record that a proof has been verified on-chain.
/// This serves as an attestation that can be referenced by other instructions
/// (e.g., the claim flow can check for a valid ProofRecord before releasing funds).
///
/// PDA Seeds: [b"proof_record", verifier.key(), nullifier]
/// Using the nullifier ensures each proof can only create one record.
#[account]
pub struct ProofRecord {
    /// The account that submitted and paid for verification
    pub verifier: Pubkey,
    /// Circuit identifier (matches VerificationKeyAccount.circuit_id)
    pub circuit_id: [u8; 32],
    /// Nullifier from the proof (for withdrawal/eligibility proofs)
    /// For identity proofs, this is the position_commitment
    pub nullifier: [u8; 32],
    /// Timestamp when the proof was verified
    pub verified_at: i64,
    /// Whether this record is still valid (can be invalidated by admin if needed)
    pub is_valid: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl ProofRecord {
    pub const SIZE: usize = 8 + // discriminator
        32 + // verifier
        32 + // circuit_id
        32 + // nullifier
        8 +  // verified_at
        1 +  // is_valid
        1;   // bump
    // Total: 114 bytes

    pub const SEED_PREFIX: &'static [u8] = b"proof_record";
}
