/**
 * usePositions Hook
 *
 * Provides vesting position data and management.
 * Note: Amounts are encrypted via Arcium MPC - displayed values are placeholders.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useProgram } from './useProgram'
import {
  fetchPositionsByOrganization,
  fetchPosition,
  getPositionStats,
  BN,
} from '@/lib/sdk'
import type {
  VestingPosition,
  PositionStats,
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

      // Fetch stats for each position (async because it needs to fetch schedule)
      const positionsWithStats: PositionWithStats[] = await Promise.all(
        positionsResult.map(async (pos) => ({
          publicKey: pos.publicKey,
          account: pos.account,
          stats: await getPositionStats(program, pos.account, currentTime),
        }))
      )

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

  return {
    positions,
    loading,
    error,
    refresh,
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
        setStats(await getPositionStats(program, positionData))
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
 * Note: Amounts are placeholders since actual values are encrypted
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

    let activePositions = 0

    for (const pos of positions) {
      if (pos.account.isActive) {
        activePositions++
      }
    }

    // Note: Amounts are encrypted via MPC - these are placeholders
    return {
      totalPositions: positions.length,
      activePositions,
      totalVested: new BN(0),
      totalClaimed: new BN(0),
      totalClaimable: new BN(0),
    }
  }, [positions])
}
