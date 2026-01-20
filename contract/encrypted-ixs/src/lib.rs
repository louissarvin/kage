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

    /// Input for calculating vested amount
    pub struct CalculateVestedInput {
        /// Encrypted total amount
        total_amount: u64,
        /// Encrypted claimed amount
        claimed_amount: u64,
        /// Cliff duration in seconds
        cliff_duration: u64,
        /// Total vesting duration in seconds
        total_duration: u64,
        /// Vesting interval in seconds
        vesting_interval: u64,
        /// Start timestamp
        start_timestamp: u64,
        /// Current timestamp
        current_timestamp: u64,
    }

    /// Output for calculate_vested
    pub struct CalculateVestedResult {
        /// Vested amount
        vested_amount: u64,
        /// Claimable amount (vested - claimed)
        claimable_amount: u64,
    }

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

    /// Calculate the vested amount based on time elapsed
    #[instruction]
    pub fn calculate_vested(
        input: Enc<Shared, CalculateVestedInput>,
    ) -> Enc<Shared, CalculateVestedResult> {
        let data = input.to_arcis();

        // Calculate elapsed time
        let elapsed = if data.current_timestamp > data.start_timestamp {
            data.current_timestamp - data.start_timestamp
        } else {
            0
        };

        // Check if cliff has passed
        let cliff_passed = elapsed >= data.cliff_duration;

        // Calculate vested amount
        let vested_amount: u64 = if !cliff_passed {
            0
        } else if elapsed >= data.total_duration {
            // Fully vested
            data.total_amount
        } else {
            // Calculate linear vesting with interval snapshots
            let vesting_time = elapsed - data.cliff_duration;
            let intervals_passed = vesting_time / data.vesting_interval;
            let vested_time = intervals_passed * data.vesting_interval + data.cliff_duration;

            // Linear vesting: total * vested_time / total_duration
            // Use checked math to avoid overflow
            let numerator = data.total_amount * vested_time;
            numerator / data.total_duration
        };

        // Calculate claimable amount (vested - claimed)
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
