use anchor_lang::prelude::*;

/// Organization account that manages vesting schedules and positions.
/// Seeds: [b"organization", admin.key()]
#[account]
pub struct Organization {
    /// Admin public key who can manage this organization
    pub admin: Pubkey,
    /// Hash of the organization name for privacy
    pub name_hash: [u8; 32],
    /// Number of vesting schedules created
    pub schedule_count: u64,
    /// Number of vesting positions created
    pub position_count: u64,
    /// Treasury account for token storage
    pub treasury: Pubkey,
    /// Token mint for vesting payments
    pub token_mint: Pubkey,
    /// Whether the organization is active
    pub is_active: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl Organization {
    pub const SIZE: usize = 8 + // discriminator
        32 + // admin
        32 + // name_hash
        8 +  // schedule_count
        8 +  // position_count
        32 + // treasury
        32 + // token_mint
        1 +  // is_active
        1;   // bump
    // Total: 154 bytes

    pub const SEED_PREFIX: &'static [u8] = b"organization";
}
