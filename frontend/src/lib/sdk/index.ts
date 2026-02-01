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

// Meta-keys vault (Arcium MPC storage)
export {
  writeMetaKeysToVault,
  readMetaKeysFromVault,
  waitForMetaKeysEvent,
  decryptMetaKeysFromEvent,
  getMetaKeysVault,
  findMetaKeysVaultPda,
} from './metaKeysVault'

export type {
  WriteMetaKeysResult,
  ReadMetaKeysResult,
  MetaKeysRetrievedEvent,
  DecryptedMetaKeys,
} from './metaKeysVault'

// Compressed positions (Light Protocol)
export {
  // RPC initialization
  createLightRpc,
  // Address derivation
  deriveCompressedPositionAddress,
  // Serialization helpers
  serializeValidityProof,
  serializePackedAddressTreeInfo,
  serializeCompressedAccountMeta,
  serializeCompressedAccountMetaForUpdate,
  // Account parsing
  parseCompressedPositionData,
  // Remaining accounts builders
  buildLightRemainingAccountsFromTrees,
  buildLightRemainingAccountsForUpdate,
  // Core operations
  createCompressedVestingPosition,
  fetchCompressedPosition,
  fetchCompressedPositionForClaim,
  authorizeClaimCompressed,
  buildAuthorizeClaimInstruction,
  updateCompressedPositionClaimed,
  // Utilities
  createNullifier as createNullifierAsync,
  waitForCompressedAccount,
  getAddressMerkleTree,
  getDefaultStateTreeAccounts,
  // Employee scanning
  scanCompressedPositionsForEmployee,
  fetchAllCompressedPositions,
} from './compressedPosition'

// Re-export Light Protocol utilities for convenience
export { bn, defaultTestStateTreeAccounts } from '@lightprotocol/stateless.js'

export type {
  CompressedPositionData,
  CompressedPositionWithAccount,
  CreateCompressedPositionParams,
  CreateCompressedPositionResult,
  AuthorizeClaimCompressedParams,
  UpdateCompressedPositionParams,
  CompressedPositionWithAddress,
} from './compressedPosition'

// Re-export Light Protocol Rpc type for TypeScript
export type { Rpc } from '@lightprotocol/stateless.js'
