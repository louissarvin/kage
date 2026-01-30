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
  createOrganizationWithVault,
  fetchOrganization,
  fetchOrganizationByAdmin,
  fetchAllOrganizations,
  initializeVault,
  depositToVault,
  createVestingSchedule,
  fetchSchedule,
  fetchSchedulesByOrganization,
  getOrganizationStats,
  hashName,
  getNameHashHex,
} from './organization'

export type {
  CreateOrganizationParams,
  CreateOrganizationWithVaultParams,
  CreateScheduleParams,
  OrganizationStats,
} from './organization'

// Position management
export {
  createPositionWithPreparedData,
  createBeneficiaryCommitment,
  encodeAmount,
  fetchPosition,
  fetchPositionsByOrganization,
  fetchPositionsByCommitment,
  calculateVestingProgress,
  getPositionStats,
  withdrawTokens,
} from './position'

export type {
  CreatePositionParams,
  PositionStats,
} from './position'
