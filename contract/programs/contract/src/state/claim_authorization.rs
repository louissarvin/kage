use anchor_lang::prelude::*;

/// Authorization record for a claim against a vesting position.
/// Created by authorize_claim after Ed25519 signature verification.
/// Seeds: [b"claim_auth", position.key(), nullifier]
#[account]
pub struct ClaimAuthorization {
    /// The vesting position being claimed against
    pub position: Pubkey,
    /// Nullifier to prevent double-claims (derived from identity_secret + position_id)
    pub nullifier: [u8; 32],
    /// Destination token account for withdrawal
    pub withdrawal_destination: Pubkey,
    /// Amount to claim (set during queue_process_claim)
    pub claim_amount: u64,
    /// Whether the Ed25519 signature was verified
    pub is_authorized: bool,
    /// Whether MPC processing is complete
    pub is_processed: bool,
    /// Whether tokens have been withdrawn
    pub is_withdrawn: bool,
    /// Timestamp of authorization
    pub authorized_at: i64,
    /// PDA bump seed
    pub bump: u8,
}

impl ClaimAuthorization {
    pub const SIZE: usize = 8 +  // discriminator
        32 + // position
        32 + // nullifier
        32 + // withdrawal_destination
        8 +  // claim_amount
        1 +  // is_authorized
        1 +  // is_processed
        1 +  // is_withdrawn
        8 +  // authorized_at
        1;   // bump
    // Total: 124 bytes

    pub const SEED_PREFIX: &'static [u8] = b"claim_auth";
}

/// Record that a nullifier has been used, preventing double-claims.
/// Uses init constraint - existence means used. Second init with same seeds fails.
/// Seeds: [b"nullifier", organization.key(), nullifier]
#[account]
pub struct NullifierRecord {
    /// The nullifier value
    pub nullifier: [u8; 32],
    /// The position this nullifier was used for
    pub position: Pubkey,
    /// Timestamp when nullifier was consumed
    pub used_at: i64,
    /// PDA bump seed
    pub bump: u8,
}

impl NullifierRecord {
    pub const SIZE: usize = 8 +  // discriminator
        32 + // nullifier
        32 + // position
        8 +  // used_at
        1;   // bump
    // Total: 81 bytes

    pub const SEED_PREFIX: &'static [u8] = b"nullifier";
}
