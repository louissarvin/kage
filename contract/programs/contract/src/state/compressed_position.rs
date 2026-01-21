use anchor_lang::prelude::*;
use light_sdk::{LightDiscriminator, LightHasher};

/// Compressed Vesting Position stored in Light Protocol Merkle tree.
/// This provides 5000x cost reduction compared to regular Solana accounts.
///
/// The compressed position stores encrypted vesting data in a Merkle tree,
/// combining Light Protocol's cost efficiency with Arcium's privacy.
///
/// Light Protocol derives:
/// - LightDiscriminator: Provides unique 8-byte discriminator for the account type
/// - LightHasher: Implements DataHasher for Merkle tree storage (uses Poseidon by default)
#[derive(
    Clone,
    Debug,
    Default,
    LightDiscriminator,
    LightHasher,
    AnchorSerialize,
    AnchorDeserialize,
)]
pub struct CompressedVestingPosition {
    /// Owner of this position (for address derivation)
    #[hash]
    pub owner: Pubkey,
    /// Organization this position belongs to
    #[hash]
    pub organization: Pubkey,
    /// Vesting schedule used for this position
    #[hash]
    pub schedule: Pubkey,
    /// Unique position identifier within the organization
    #[hash]
    pub position_id: u64,
    /// Commitment hash of beneficiary identity (Pedersen commitment for privacy)
    #[hash]
    pub beneficiary_commitment: [u8; 32],
    /// Encrypted total vesting amount (Arcium ciphertext)
    #[hash]
    pub encrypted_total_amount: [u8; 32],
    /// Encrypted amount already claimed (Arcium ciphertext)
    #[hash]
    pub encrypted_claimed_amount: [u8; 32],
    /// Nonce for Arcium encryption
    #[hash]
    pub nonce: u128,
    /// Vesting start timestamp (Unix seconds)
    #[hash]
    pub start_timestamp: i64,
    /// Whether this position is active
    #[hash]
    pub is_active: u8, // 1 = active, 0 = inactive (u8 for Light compatibility)
    /// Whether all tokens have been claimed
    #[hash]
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
