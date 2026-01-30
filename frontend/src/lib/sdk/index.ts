/**
 * ShadowVest SDK
 *
 * Re-export all SDK modules for easy importing.
 */

// Program setup and types
export {
  PROGRAM_ID,
  BN,
  createProvider,
  getProgram,
  createProgram,
  // PDA helpers
  findOrganizationPda,
  findSchedulePda,
  findPositionPda,
  findVaultAuthorityPda,
  findVaultPda,
  findStealthMetaPda,
  findClaimAuthorizationPda,
  findNullifierPda,
} from './program'

export type {
  ShadowVestProgram,
  Organization,
  VestingSchedule,
  VestingPosition,
  StealthMeta,
  ClaimAuthorization,
} from './program'

// Organization management
export {
  createOrganization,
  fetchOrganization,
  fetchOrganizationByAdmin,
  fetchAllOrganizations,
  initializeVault,
  depositToVault,
  createVestingSchedule,
  fetchSchedule,
  fetchSchedulesByOrganization,
  getOrganizationStats,
} from './organization'

export type {
  CreateOrganizationParams,
  CreateScheduleParams,
  OrganizationStats,
} from './organization'

// Position management
export {
  createVestingPosition,
  createStealthVestingPosition,
  fetchPosition,
  fetchPositionsByOrganization,
  fetchPositionsByCommitment,
  calculateVestedAmount,
  calculateClaimableAmount,
  getVestingProgress,
  getPositionStats,
  withdrawTokens,
} from './position'

export type {
  CreatePositionParams,
  PositionStats,
} from './position'
