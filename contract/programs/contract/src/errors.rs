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
}
