use anchor_lang::prelude::*;

/// Vesting position with encrypted amounts for privacy.
/// Seeds: [b"vesting_position", organization.key(), position_id.to_le_bytes()]
#[account]
pub struct VestingPosition {
    /// Organization this position belongs to
    pub organization: Pubkey,
    /// Vesting schedule used for this position
    pub schedule: Pubkey,
    /// Unique position identifier within the organization
    pub position_id: u64,
    /// Commitment hash of beneficiary identity (for privacy)
    pub beneficiary_commitment: [u8; 32],
    /// Encrypted total vesting amount (single ciphertext for u64)
    pub encrypted_total_amount: [u8; 32],
    /// Encrypted amount already claimed (single ciphertext for u64)
    pub encrypted_claimed_amount: [u8; 32],
    /// Nonce for encryption
    pub nonce: u128,
    /// Start timestamp for vesting
    pub start_timestamp: i64,
    /// Whether this position is active
    pub is_active: bool,
    /// Whether all tokens have been claimed
    pub is_fully_claimed: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl VestingPosition {
    pub const SIZE: usize = 8 +  // discriminator
        32 + // organization
        32 + // schedule
        8 +  // position_id
        32 + // beneficiary_commitment
        32 + // encrypted_total_amount
        32 + // encrypted_claimed_amount
        16 + // nonce
        8 +  // start_timestamp
        1 +  // is_active
        1 +  // is_fully_claimed
        1;   // bump
    // Total: 203 bytes

    pub const SEED_PREFIX: &'static [u8] = b"vesting_position";
}
