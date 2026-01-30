/**
 * usePositions Hook
 *
 * Provides vesting position data and management.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useProgram } from './useProgram'
import {
  fetchPositionsByOrganization,
  fetchPosition,
  getPositionStats,
  createVestingPosition as createPosition,
  BN,
} from '@/lib/sdk'
import type {
  VestingPosition,
  PositionStats,
  CreatePositionParams,
} from '@/lib/sdk'

export interface PositionWithStats {
  publicKey: PublicKey
  account: VestingPosition
  stats: PositionStats
}

export interface UsePositionsResult {
  positions: PositionWithStats[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createPosition: (params: CreatePositionParams) => Promise<{ signature: string; positionId: number }>
}

/**
 * Hook to manage positions for an organization
 */
export function usePositions(organization: PublicKey | null): UsePositionsResult {
  const program = useProgram()

  const [positions, setPositions] = useState<PositionWithStats[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!program || !organization) {
      setPositions([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const positionsResult = await fetchPositionsByOrganization(program, organization)
      const currentTime = Math.floor(Date.now() / 1000)

      const positionsWithStats: PositionWithStats[] = positionsResult.map((pos) => ({
        publicKey: pos.publicKey,
        account: pos.account,
        stats: getPositionStats(pos.account, currentTime),
      }))

      // Sort by position ID descending (newest first)
      positionsWithStats.sort((a, b) =>
        b.account.positionId.toNumber() - a.account.positionId.toNumber()
      )

      setPositions(positionsWithStats)
    } catch (err) {
      console.error('Failed to fetch positions:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch positions')
    } finally {
      setLoading(false)
    }
  }, [program, organization])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Auto-refresh stats every minute
  useEffect(() => {
    if (positions.length === 0) return

    const interval = setInterval(() => {
      const currentTime = Math.floor(Date.now() / 1000)
      setPositions((prev) =>
        prev.map((pos) => ({
          ...pos,
          stats: getPositionStats(pos.account, currentTime),
        }))
      )
    }, 60000) // Every minute

    return () => clearInterval(interval)
  }, [positions.length])

  const createPositionHandler = useCallback(
    async (params: CreatePositionParams): Promise<{ signature: string; positionId: number }> => {
      if (!program || !organization) throw new Error('Organization not found')

      const result = await createPosition(program, organization, params)
      await refresh()
      return { signature: result.signature, positionId: result.positionId }
    },
    [program, organization, refresh]
  )

  return {
    positions,
    loading,
    error,
    refresh,
    createPosition: createPositionHandler,
  }
}

/**
 * Hook to fetch a single position
 */
export function usePosition(positionPubkey: PublicKey | null) {
  const program = useProgram()

  const [position, setPosition] = useState<VestingPosition | null>(null)
  const [stats, setStats] = useState<PositionStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!program || !positionPubkey) {
      setPosition(null)
      setStats(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const positionData = await fetchPosition(program, positionPubkey)
      if (positionData) {
        setPosition(positionData)
        setStats(getPositionStats(positionData))
      } else {
        setPosition(null)
        setStats(null)
      }
    } catch (err) {
      console.error('Failed to fetch position:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch position')
    } finally {
      setLoading(false)
    }
  }, [program, positionPubkey])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { position, stats, loading, error, refresh }
}

/**
 * Hook to get aggregated stats across all positions
 */
export function usePositionAggregates(positions: PositionWithStats[]) {
  return useMemo(() => {
    if (positions.length === 0) {
      return {
        totalPositions: 0,
        activePositions: 0,
        totalVested: new BN(0),
        totalClaimed: new BN(0),
        totalClaimable: new BN(0),
      }
    }

    let totalVested = new BN(0)
    let totalClaimed = new BN(0)
    let totalClaimable = new BN(0)
    let activePositions = 0

    for (const pos of positions) {
      if (pos.account.isActive) {
        activePositions++
      }
      totalVested = totalVested.add(pos.stats.vestedAmount)
      totalClaimed = totalClaimed.add(pos.stats.claimedAmount)
      totalClaimable = totalClaimable.add(pos.stats.claimableAmount)
    }

    return {
      totalPositions: positions.length,
      activePositions,
      totalVested,
      totalClaimed,
      totalClaimable,
    }
  }, [positions])
}
