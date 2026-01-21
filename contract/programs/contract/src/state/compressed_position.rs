use anchor_lang::prelude::*;
use light_sdk::LightDiscriminator;

/// Compressed Vesting Position stored in Light Protocol Merkle tree.
/// This provides 5000x cost reduction compared to regular Solana accounts.
///
/// The compressed position stores encrypted vesting data in a Merkle tree,
/// combining Light Protocol's cost efficiency with Arcium's privacy.
#[derive(Clone, Debug, Default, LightDiscriminator, AnchorSerialize, AnchorDeserialize)]
pub struct CompressedVestingPosition {
    /// Owner of this position (for address derivation)
    pub owner: Pubkey,
    /// Organization this position belongs to
    pub organization: Pubkey,
    /// Vesting schedule used for this position
    pub schedule: Pubkey,
    /// Unique position identifier within the organization
    pub position_id: u64,
    /// Commitment hash of beneficiary identity (Pedersen commitment for privacy)
    pub beneficiary_commitment: [u8; 32],
    /// Encrypted total vesting amount (Arcium ciphertext)
    pub encrypted_total_amount: [u8; 32],
    /// Encrypted amount already claimed (Arcium ciphertext)
    pub encrypted_claimed_amount: [u8; 32],
    /// Nonce for Arcium encryption
    pub nonce: u128,
    /// Vesting start timestamp (Unix seconds)
    pub start_timestamp: i64,
    /// Whether this position is active
    pub is_active: u8, // 1 = active, 0 = inactive (u8 for Light compatibility)
    /// Whether all tokens have been claimed
    pub is_fully_claimed: u8, // 1 = fully claimed, 0 = not
}

impl CompressedVestingPosition {
    /// Seed prefix for address derivation
    pub const SEED_PREFIX: &'static [u8] = b"compressed_position";

    /// Create a new compressed vesting position
    pub fn new(
        owner: Pubkey,
        organization: Pubkey,
        schedule: Pubkey,
        position_id: u64,
        beneficiary_commitment: [u8; 32],
        encrypted_total_amount: [u8; 32],
        nonce: u128,
        start_timestamp: i64,
    ) -> Self {
        Self {
            owner,
            organization,
            schedule,
            position_id,
            beneficiary_commitment,
            encrypted_total_amount,
            encrypted_claimed_amount: [0u8; 32], // Initially zero
            nonce,
            start_timestamp,
            is_active: 1,
            is_fully_claimed: 0,
        }
    }

    /// Check if position is active
    pub fn is_active(&self) -> bool {
        self.is_active == 1
    }

    /// Check if position is fully claimed
    pub fn is_fully_claimed(&self) -> bool {
        self.is_fully_claimed == 1
    }

    /// Mark position as fully claimed
    pub fn mark_fully_claimed(&mut self) {
        self.is_fully_claimed = 1;
    }

    /// Deactivate position
    pub fn deactivate(&mut self) {
        self.is_active = 0;
    }

    /// Update encrypted claimed amount
    pub fn update_claimed_amount(&mut self, new_encrypted_claimed: [u8; 32]) {
        self.encrypted_claimed_amount = new_encrypted_claimed;
    }
}
