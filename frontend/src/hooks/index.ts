/**
 * Hooks Index
 *
 * Re-export all hooks for easy importing.
 */

// On-chain hooks
export { useProgram, useProvider } from './useProgram'
export { useOrganization, useAllOrganizations } from './useOrganization'
export {
  usePositions,
  usePosition,
  usePositionAggregates,
  useEmployeePositions, // @deprecated - use useMyPositions instead
  useMyPositions, // New: fetches positions from database
} from './usePositions'

// Backend hooks
export {
  useLinks,
  useStealthKeys,
  useLookupEmployee,
  useSlugAvailability,
} from './useBackend'

// Vault keys (Arcium MPC retrieval)
export { useVaultKeys } from './useVaultKeys'

// Types
export type { UseOrganizationResult } from './useOrganization'
export type {
  UsePositionsResult,
  PositionWithStats,
  UseMyPositionsResult,
  MyPositionWithStats,
  OnChainPositionData,
  ClaimStatus,
} from './usePositions'
export type {
  UseLinksResult,
  UseStealthKeysResult,
  UseLookupEmployeeResult,
  UseSlugAvailabilityResult,
} from './useBackend'
export type { UseVaultKeysResult } from './useVaultKeys'
