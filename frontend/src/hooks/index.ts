/**
 * Hooks Index
 *
 * Re-export all hooks for easy importing.
 */

// On-chain hooks
export { useProgram, useProvider } from './useProgram'
export { useOrganization, useAllOrganizations } from './useOrganization'
export { usePositions, usePosition, usePositionAggregates } from './usePositions'

// Backend hooks
export {
  useLinks,
  useStealthKeys,
  useLookupEmployee,
  useSlugAvailability,
} from './useBackend'

// Types
export type { UseOrganizationResult } from './useOrganization'
export type { UsePositionsResult, PositionWithStats } from './usePositions'
export type {
  UseLinksResult,
  UseStealthKeysResult,
  UseLookupEmployeeResult,
  UseSlugAvailabilityResult,
} from './useBackend'
