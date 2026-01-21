use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    /// Input for initializing a vesting position
    /// For simplicity, we use a single u64 for the total amount
    pub struct InitPositionInput {
        /// Total vesting amount
        total_amount: u64,
    }

    /// Output for init_position
    pub struct InitPositionResult {
        /// Total vesting amount (echoed back)
        total_amount: u64,
        /// Claimed amount (initialized to 0)
        claimed_amount: u64,
    }

    /// Input for calculating vested amount (OPTIMIZED)
    /// Time-based fraction is pre-computed off-chain from exact timestamps in seconds
    /// This avoids expensive division in MPC while keeping exact time semantics
    pub struct CalculateVestedInput {
        /// Encrypted total amount
        total_amount: u64,
        /// Encrypted claimed amount
        claimed_amount: u64,
        /// Vesting numerator - pre-computed from timestamps (0 to PRECISION)
        /// Calculated off-chain as: (elapsed_intervals * interval) * PRECISION / vesting_duration
        /// = 0 if cliff not passed
        /// = PRECISION (1_000_000) if fully vested
        /// This preserves exact second-based vesting with interval snapshots
        vesting_numerator: u64,
    }

    /// Output for calculate_vested
    pub struct CalculateVestedResult {
        /// Vested amount
        vested_amount: u64,
        /// Claimable amount (vested - claimed)
        claimable_amount: u64,
    }

    /// Precision constant for vesting fraction (10^6 = 0.0001% precision)
    const PRECISION: u64 = 1_000_000;

    /// Input for processing a claim
    pub struct ProcessClaimInput {
        /// Encrypted claimed amount
        claimed_amount: u64,
        /// Amount being claimed
        claim_amount: u64,
        /// Maximum claimable amount
        max_claimable: u64,
    }

    /// Output for process_claim
    pub struct ProcessClaimResult {
        /// New claimed amount
        new_claimed_amount: u64,
        /// Whether the claim is valid (1 = valid, 0 = invalid)
        is_valid: u8,
    }

    /// Initialize a vesting position with encrypted amounts
    #[instruction]
    pub fn init_position(input: Enc<Shared, InitPositionInput>) -> Enc<Shared, InitPositionResult> {
        let data = input.to_arcis();

        let result = InitPositionResult {
            total_amount: data.total_amount,
            claimed_amount: 0u64,
        };

        input.owner.from_arcis(result)
    }

    /// Calculate the vested amount based on pre-computed time fraction
    ///
    /// The vesting_numerator is computed off-chain from exact timestamps:
    /// ```
    /// if current_time < start_time + cliff_duration:
    ///     vesting_numerator = 0
    /// elif current_time >= start_time + total_duration:
    ///     vesting_numerator = PRECISION (1_000_000)
    /// else:
    ///     elapsed = current_time - start_time - cliff_duration
    ///     intervals = elapsed / vesting_interval
    ///     vested_seconds = intervals * vesting_interval
    ///     vesting_numerator = vested_seconds * PRECISION / (total_duration - cliff_duration)
    /// ```
    ///
    /// This keeps exact second-based semantics while avoiding expensive MPC division
    #[instruction]
    pub fn calculate_vested(
        input: Enc<Shared, CalculateVestedInput>,
    ) -> Enc<Shared, CalculateVestedResult> {
        let data = input.to_arcis();

        // Simple calculation: vested = total * numerator / PRECISION
        // The division by constant PRECISION is much cheaper than variable division
        let vested_amount = data.total_amount * data.vesting_numerator / PRECISION;

        // Claimable = vested - claimed (if positive)
        let claimable_amount = if vested_amount > data.claimed_amount {
            vested_amount - data.claimed_amount
        } else {
            0
        };

        let result = CalculateVestedResult {
            vested_amount,
            claimable_amount,
        };

        input.owner.from_arcis(result)
    }

    /// Process a claim and validate the amount
    #[instruction]
    pub fn process_claim(input: Enc<Shared, ProcessClaimInput>) -> Enc<Shared, ProcessClaimResult> {
        let data = input.to_arcis();

        // Validate claim amount
        let is_valid = data.claim_amount <= data.max_claimable;

        // Calculate new claimed amount
        let new_claimed_amount = if is_valid {
            data.claimed_amount + data.claim_amount
        } else {
            data.claimed_amount // No change if invalid
        };

        let result = ProcessClaimResult {
            new_claimed_amount,
            is_valid: if is_valid { 1u8 } else { 0u8 },
        };

        input.owner.from_arcis(result)
    }
}
