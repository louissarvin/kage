/**
 * useOrganization Hook
 *
 * Provides organization data and management functions.
 * Integrates with both on-chain data and backend API.
 */

import { useState, useEffect, useCallback } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'
import { useProgram } from './useProgram'
import { api } from '@/lib/api'
import {
  fetchOrganizationByAdmin,
  fetchAllOrganizations,
  fetchSchedulesByOrganization,
  getOrganizationStats,
  createOrganization as createOrg,
  createOrganizationWithVault as createOrgWithVault,
  initializeVault as initVault,
  depositToVault as deposit,
  createVestingSchedule as createSchedule,
  createPositionWithPreparedData,
  BN,
  getNameHashHex,
} from '@/lib/sdk'
import type {
  Organization,
  VestingSchedule,
  OrganizationStats,
  CreateOrganizationParams,
  CreateOrganizationWithVaultParams,
  CreateScheduleParams,
} from '@/lib/sdk'

export interface UseOrganizationResult {
  // Data
  organization: PublicKey | null
  organizationData: Organization | null
  schedules: Array<{ publicKey: PublicKey; account: VestingSchedule }>
  stats: OrganizationStats | null

  // Loading states
  loading: boolean
  error: string | null

  // Actions
  refresh: () => Promise<void>
  createOrganization: (params: CreateOrganizationParams) => Promise<string>
  createOrganizationWithVault: (params: CreateOrganizationWithVaultParams) => Promise<{
    signature: string
    depositSignature?: string
  }>
  initializeVault: () => Promise<string>
  depositToVault: (amount: BN) => Promise<string>
  createSchedule: (params: CreateScheduleParams) => Promise<{ signature: string; scheduleId: number }>
  createPositionForEmployee: (
    scheduleId: number,
    employeeSlug: string,
    amount: BN
  ) => Promise<{ signature: string; positionId: number }>
}

/**
 * Hook to manage the current user's organization
 */
export function useOrganization(): UseOrganizationResult {
  const { publicKey } = useWallet()
  const program = useProgram()

  const [organization, setOrganization] = useState<PublicKey | null>(null)
  const [organizationData, setOrganizationData] = useState<Organization | null>(null)
  const [schedules, setSchedules] = useState<Array<{ publicKey: PublicKey; account: VestingSchedule }>>([])
  const [stats, setStats] = useState<OrganizationStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch organization data
  const refresh = useCallback(async () => {
    if (!program || !publicKey) {
      setOrganization(null)
      setOrganizationData(null)
      setSchedules([])
      setStats(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Fetch organization by admin
      console.log('Fetching organization for admin:', publicKey.toBase58())
      const result = await fetchOrganizationByAdmin(program, publicKey)
      console.log('Organization fetch result:', result)

      if (result) {
        setOrganization(result.organization)
        setOrganizationData(result.data)

        // Fetch schedules
        const schedulesResult = await fetchSchedulesByOrganization(program, result.organization)
        setSchedules(schedulesResult)

        // Fetch stats
        const statsResult = await getOrganizationStats(program, result.organization)
        setStats(statsResult)
      } else {
        setOrganization(null)
        setOrganizationData(null)
        setSchedules([])
        setStats(null)
      }
    } catch (err) {
      console.error('Failed to fetch organization:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch organization')
    } finally {
      setLoading(false)
    }
  }, [program, publicKey])

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    refresh()
  }, [refresh])

  // Create organization (on-chain + backend linking)
  const createOrganization = useCallback(
    async (params: CreateOrganizationParams): Promise<string> => {
      if (!program || !publicKey) throw new Error('Wallet not connected')

      // Create on-chain
      const result = await createOrg(program, params)

      // Link to backend (if authenticated)
      if (api.isAuthenticated()) {
        try {
          const nameHash = await getNameHashHex(params.name)
          await api.linkOrganization(
            result.organization.toBase58(),
            publicKey.toBase58(),
            nameHash,
            params.tokenMint.toBase58(),
            result.organization.toBase58() // treasury is derived from org
          )
        } catch (err) {
          console.warn('Failed to link organization to backend:', err)
          // Don't fail the whole operation if backend linking fails
        }
      }

      await refresh()
      return result.signature
    },
    [program, publicKey, refresh]
  )

  // Create organization with vault (combined flow - better UX)
  const createOrganizationWithVault = useCallback(
    async (params: CreateOrganizationWithVaultParams): Promise<{
      signature: string
      depositSignature?: string
    }> => {
      if (!program || !publicKey) throw new Error('Wallet not connected')

      // Create on-chain with vault
      const result = await createOrgWithVault(program, params)

      // Link to backend (if authenticated)
      if (api.isAuthenticated()) {
        try {
          const nameHash = await getNameHashHex(params.name)
          await api.linkOrganization(
            result.organization.toBase58(),
            publicKey.toBase58(),
            nameHash,
            params.tokenMint.toBase58(),
            result.organization.toBase58()
          )
        } catch (err) {
          console.warn('Failed to link organization to backend:', err)
        }
      }

      await refresh()
      return {
        signature: result.signature,
        depositSignature: result.depositSignature,
      }
    },
    [program, publicKey, refresh]
  )

  // Initialize vault
  const initializeVault = useCallback(async (): Promise<string> => {
    if (!program || !organization) throw new Error('Organization not found')

    const result = await initVault(program, organization)
    await refresh()
    return result.signature
  }, [program, organization, refresh])

  // Deposit to vault
  const depositToVault = useCallback(
    async (amount: BN): Promise<string> => {
      if (!program || !organization) throw new Error('Organization not found')

      const signature = await deposit(program, organization, amount)
      await refresh()
      return signature
    },
    [program, organization, refresh]
  )

  // Create vesting schedule
  const createScheduleHandler = useCallback(
    async (params: CreateScheduleParams): Promise<{ signature: string; scheduleId: number }> => {
      if (!program || !organization) throw new Error('Organization not found')

      const result = await createSchedule(program, organization, params)
      await refresh()
      return { signature: result.signature, scheduleId: result.scheduleId }
    },
    [program, organization, refresh]
  )

  // Create position for employee (uses backend relay for Arcium MPC encryption)
  const createPositionForEmployee = useCallback(
    async (
      scheduleId: number,
      employeeSlug: string,
      amount: BN
    ): Promise<{ signature: string; positionId: number }> => {
      if (!program || !organization) throw new Error('Organization not found')

      // Step 1: Call backend to prepare encrypted data
      const preparedData = await api.preparePositionOnChain({
        organizationPubkey: organization.toBase58(),
        scheduleIndex: scheduleId,
        employeeSlug,
        amount: amount.toString(),
      })

      // Step 2: Build and submit transaction using prepared encrypted data
      const result = await createPositionWithPreparedData(
        program,
        organization,
        preparedData
      )
      await refresh()
      return result
    },
    [program, organization, refresh]
  )

  return {
    organization,
    organizationData,
    schedules,
    stats,
    loading,
    error,
    refresh,
    createOrganization,
    createOrganizationWithVault,
    initializeVault,
    depositToVault,
    createSchedule: createScheduleHandler,
    createPositionForEmployee,
  }
}

/**
 * Hook to fetch all organizations (for browsing)
 */
export function useAllOrganizations() {
  const program = useProgram()
  const [organizations, setOrganizations] = useState<Array<{ publicKey: PublicKey; account: Organization }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!program) {
      setOrganizations([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await fetchAllOrganizations(program)
      setOrganizations(result)
    } catch (err) {
      console.error('Failed to fetch organizations:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch organizations')
    } finally {
      setLoading(false)
    }
  }, [program])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { organizations, loading, error, refresh }
}
