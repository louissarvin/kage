use anchor_lang::prelude::*;

/// Vesting schedule defining the parameters for a vesting plan.
/// Seeds: [b"vesting_schedule", organization.key(), schedule_id.to_le_bytes()]
#[account]
pub struct VestingSchedule {
    /// Organization this schedule belongs to
    pub organization: Pubkey,
    /// Unique schedule identifier within the organization
    pub schedule_id: u64,
    /// Cliff duration in seconds before vesting begins
    pub cliff_duration: u64,
    /// Total vesting duration in seconds
    pub total_duration: u64,
    /// Interval between vesting events in seconds
    pub vesting_interval: u64,
    /// Token mint for this schedule
    pub token_mint: Pubkey,
    /// Whether this schedule is active
    pub is_active: bool,
    /// Number of positions using this schedule
    pub position_count: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl VestingSchedule {
    pub const SIZE: usize = 8 + // discriminator
        32 + // organization
        8 +  // schedule_id
        8 +  // cliff_duration
        8 +  // total_duration
        8 +  // vesting_interval
        32 + // token_mint
        1 +  // is_active
        8 +  // position_count
        1;   // bump
    // Total: 114 bytes

    pub const SEED_PREFIX: &'static [u8] = b"vesting_schedule";
}
