use anchor_lang::prelude::*;

#[error_code]
pub enum ShadowVestError {
    #[msg("The computation was aborted")]
    AbortedComputation,

    #[msg("Cluster not set")]
    ClusterNotSet,

    #[msg("Organization is not active")]
    OrganizationNotActive,

    #[msg("Vesting schedule is not active")]
    ScheduleNotActive,

    #[msg("Vesting position is not active")]
    PositionNotActive,

    #[msg("Position is fully claimed")]
    PositionFullyClaimed,

    #[msg("Unauthorized admin")]
    UnauthorizedAdmin,

    #[msg("Invalid schedule parameters")]
    InvalidScheduleParams,

    #[msg("Cliff period not passed")]
    CliffNotPassed,

    #[msg("Invalid claim amount")]
    InvalidClaimAmount,

    #[msg("Computation output verification failed")]
    OutputVerificationFailed,

    #[msg("Invalid beneficiary commitment")]
    InvalidBeneficiaryCommitment,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid token mint")]
    InvalidTokenMint,

    #[msg("Position does not belong to this organization")]
    InvalidPositionOrganization,

    #[msg("Invalid address tree for Light Protocol")]
    InvalidAddressTree,

    #[msg("Light Protocol CPI failed")]
    LightProtocolCpiFailed,

    // Phase 4: Stealth address errors
    #[msg("Unauthorized owner")]
    UnauthorizedOwner,

    #[msg("Stealth meta-address is not active")]
    StealthMetaNotActive,

    #[msg("Meta-keys vault is not initialized")]
    MetaKeysVaultNotInitialized,

    #[msg("Invalid stealth payment")]
    InvalidStealthPayment,

    // Phase 5: Claim and withdrawal errors
    #[msg("Claim is not authorized")]
    ClaimNotAuthorized,

    #[msg("Claim has not been processed by MPC")]
    ClaimNotProcessed,

    #[msg("Claim has already been withdrawn")]
    AlreadyWithdrawn,

    #[msg("Invalid Ed25519 eligibility signature")]
    InvalidEligibilitySignature,

    #[msg("Signer does not match beneficiary commitment")]
    SignerMismatch,

    #[msg("Nullifier has already been used")]
    NullifierAlreadyUsed,

    #[msg("Invalid withdrawal destination")]
    InvalidWithdrawalDestination,

    #[msg("Insufficient vault balance for withdrawal")]
    InsufficientVaultBalance,
}
