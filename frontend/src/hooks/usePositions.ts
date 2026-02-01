/**
 * usePositions Hook
 *
 * Provides vesting position data and management.
 * Note: Amounts are encrypted via Arcium MPC - displayed values are placeholders.
 *
 * Position Discovery Flow (Full On-Chain):
 * 1. Fetch all organizations from on-chain (Anchor program)
 * 2. Scan compressed positions from Light Protocol for each organization
 * 3. Fetch StealthPaymentEvents from Helius for ephemeral data
 * 4. Use isMyStealthPayment to verify ownership
 * 5. Return only positions that belong to the current user
 *
 * This is fully on-chain - no database dependency for position discovery.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useProgram } from './useProgram'
import {
  fetchPosition,
  getPositionStats,
  fetchAllOrganizations,
  BN,
  // Light Protocol for on-chain compressed position data
  createLightRpc,
  fetchCompressedPositionForClaim,
  fetchAllCompressedPositions,
  PROGRAM_ID,
} from '@/lib/sdk'
import type {
  VestingPosition,
  PositionStats,
  CompressedPositionWithAccount,
} from '@/lib/sdk'
import { getCachedStealthKeys } from '@/lib/stealth-key-cache'
import { isMyStealthPayment } from '@/lib/stealth-address'
import { fetchAllStealthPaymentEvents, getEphemeralDataFromEvents } from '@/lib/helius-events'

// Light Protocol RPC endpoint
const LIGHT_RPC_ENDPOINT = import.meta.env.VITE_HELIUS_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=YOUR_KEY'


export interface PositionWithStats {
  publicKey: PublicKey
  account: VestingPosition
  stats: PositionStats
  isCompressed?: boolean
}

export interface UsePositionsResult {
  positions: PositionWithStats[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Hook to manage compressed positions for an organization
 * Fetches positions from Light Protocol (compressed state)
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
      // Fetch organization data to get compressed position count
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orgAccount = await (program.account as any).organization.fetch(organization)
      const compressedCount = orgAccount.compressedPositionCount?.toNumber() || 0

      if (compressedCount === 0) {
        console.log('[usePositions] No compressed positions for this organization')
        setPositions([])
        return
      }

      // Fetch compressed positions from Light Protocol
      console.log(`[usePositions] Fetching ${compressedCount} compressed positions...`)
      const lightRpc = createLightRpc(LIGHT_RPC_ENDPOINT)

      const compressedPositions = await fetchAllCompressedPositions(
        lightRpc,
        organization,
        compressedCount,
        PROGRAM_ID
      )

      console.log(`[usePositions] Found ${compressedPositions.length} positions on Light Protocol`)

      // Map compressed positions to PositionWithStats format
      const positionsWithStats: PositionWithStats[] = compressedPositions.map((pos) => {
        const startTimestamp = pos.data.startTimestamp
        const isActive = pos.data.isActive === 1
        const isFullyClaimed = pos.data.isFullyClaimed === 1

        // Calculate vesting progress (simplified - 100% for now since amounts are encrypted)
        // In production, would need to decode schedule for accurate progress
        const vestingProgress = 100

        return {
          publicKey: pos.address,
          account: {
            organization,
            schedule: pos.data.schedule,
            positionId: new BN(pos.data.positionId),
            beneficiaryCommitment: Array.from(pos.data.beneficiaryCommitment) as number[],
            encryptedTotalAmount: Array.from(pos.data.encryptedTotalAmount) as number[],
            encryptedClaimedAmount: Array.from(pos.data.encryptedClaimedAmount) as number[],
            startTimestamp: new BN(startTimestamp),
            isActive,
            isFullyClaimed,
            bump: 0, // Not applicable for compressed positions
          } as VestingPosition,
          stats: {
            vestingProgress,
            isFullyVested: isFullyClaimed || vestingProgress >= 100,
            cliffEndTime: startTimestamp,
            vestingEndTime: startTimestamp,
            totalAmount: new BN(0), // Encrypted via Arcium MPC
            claimedAmount: new BN(0), // Encrypted via Arcium MPC
            claimableAmount: new BN(0), // Encrypted via Arcium MPC
          } as PositionStats,
          isCompressed: true,
        }
      })

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

/**
 * On-chain compressed position data from Light Protocol
 */
export interface OnChainPositionData {
  owner: string
  organization: string
  schedule: string
  positionId: number
  beneficiaryCommitment: string
  startTimestamp: number
  isActive: boolean
  isFullyClaimed: boolean
  // Raw data for claims
  compressedAddress: string
  hash: Uint8Array
  treeInfo: {
    tree: string
    queue: string
  }
}

/**
 * Claim status for a position
 */
export type ClaimStatus = 'unclaimed' | 'claimed' | 'partially_claimed' | 'unknown'

/**
 * Extended position type that includes stealth data needed for claims
 */
export interface MyPositionWithStats {
  // Database ID
  id: string
  // Position PDA (may be derived for compressed positions)
  pubkey: string
  positionId: number
  // Organization info
  organizationPubkey: string
  tokenMint: string
  // Schedule info
  scheduleIndex: number
  schedulePubkey: string
  // Stealth data (needed for claim)
  stealthOwner: string
  ephemeralPub: string
  encryptedEphemeralPayload: string | null
  // Position type
  isCompressed: boolean
  // Timing
  startTimestamp: string
  cliffEndTime: number
  vestingEndTime: number
  vestingProgress: number
  status: 'cliff' | 'vesting' | 'vested'
  isInCliff: boolean
  isFullyVested: boolean
  isActive: boolean
  // Claim status (hybrid check: compressed data + ClaimAuthorization fallback)
  claimStatus: ClaimStatus
  // Link info
  receivedVia: {
    slug: string
    label: string | null
  } | null
  // On-chain data (fetched from Light Protocol)
  onChainData?: OnChainPositionData
  // Verification status
  verificationStatus: 'verified' | 'mismatch' | 'not_found' | 'error' | 'pending'
}

export interface UseMyPositionsResult {
  positions: MyPositionWithStats[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  /**
   * Fetch on-chain compressed position data from Light Protocol
   * Call this before claiming to get the latest state and validity proof
   *
   * Returns CompressedPositionWithAccount with:
   * - data: parsed position data (beneficiaryCommitment, encrypted amounts, etc.)
   * - address: compressed account address
   * - hash: account hash for validity proof
   * - treeInfo: tree and queue pubkeys for validity proof
   */
  fetchOnChainData: (position: MyPositionWithStats) => Promise<CompressedPositionWithAccount | null>
}

/**
 * Hook to fetch positions using FULL ON-CHAIN discovery
 * Following the same pattern as contract tests (stealth-compressed-flow.ts)
 *
 * Discovery Flow:
 * 1. Fetch all organizations from on-chain (Anchor program accounts)
 * 2. Scan compressed positions from Light Protocol
 * 3. Fetch StealthPaymentEvents from blockchain for ephemeral data
 * 4. Use isMyStealthPayment to verify ownership
 * 5. Return only positions that belong to the current user
 *
 * @param metaSpendPub - User's meta spend public key (for stealth verification)
 */
export function useMyPositions(metaSpendPub?: string | null): UseMyPositionsResult {
  // IMPORTANT: Call useProgram unconditionally to maintain hook order
  const program = useProgram()

  const [positions, setPositions] = useState<MyPositionWithStats[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!metaSpendPub || !program) {
      setPositions([])
      return
    }

    // Get cached stealth keys for verification
    const cachedKeys = getCachedStealthKeys()
    if (!cachedKeys) {
      console.log('[useMyPositions] No cached stealth keys - cannot verify ownership')
      setPositions([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      console.log('[useMyPositions] === FULL ON-CHAIN POSITION DISCOVERY ===')

      // Step 1: Fetch ALL organizations from on-chain
      console.log('[useMyPositions] Step 1: Fetching organizations from on-chain...')
      const organizations = await fetchAllOrganizations(program)
      console.log(`[useMyPositions] Found ${organizations.length} organizations on-chain`)

      // Filter to only orgs with compressed positions
      const orgsWithCompressed = organizations.filter(
        org => org.account.compressedPositionCount?.toNumber() > 0
      )
      console.log(`[useMyPositions] ${orgsWithCompressed.length} organizations have compressed positions`)

      if (orgsWithCompressed.length === 0) {
        console.log('[useMyPositions] No compressed positions found on-chain')
        setPositions([])
        return
      }

      // Step 2: Fetch StealthPaymentEvents from blockchain
      // Use cache when available to avoid rate limits (429 errors)
      console.log('[useMyPositions] Step 2: Fetching StealthPaymentEvents from blockchain...')
      const stealthEvents = await fetchAllStealthPaymentEvents(100, false) // Use cache, limit 100 txs
      console.log(`[useMyPositions] Found ${stealthEvents.size} stealth payment events`)

      // Step 3: Scan compressed positions from Light Protocol
      console.log('[useMyPositions] Step 3: Scanning compressed positions from Light Protocol...')
      const lightRpc = createLightRpc(LIGHT_RPC_ENDPOINT)

      const myPositions: MyPositionWithStats[] = []

      for (const org of orgsWithCompressed) {
        const compressedCount = org.account.compressedPositionCount.toNumber()
        console.log(`[useMyPositions] Scanning org ${org.publicKey.toBase58().slice(0, 8)}... (${compressedCount} positions)`)

        // Fetch all compressed positions for this org
        const compressedPositions = await fetchAllCompressedPositions(
          lightRpc,
          org.publicKey,
          compressedCount,
          PROGRAM_ID
        )

        console.log(`[useMyPositions] Found ${compressedPositions.length} positions on Light Protocol`)

        // Step 4: For each position, verify ownership using isMyStealthPayment
        for (const pos of compressedPositions) {
          try {
            const beneficiaryCommitment = new PublicKey(pos.data.beneficiaryCommitment)

            // Get ephemeral data from blockchain events
            const eventData = getEphemeralDataFromEvents(
              stealthEvents,
              org.publicKey,
              pos.data.positionId
            )

            if (!eventData) {
              console.log(`[useMyPositions] No event data for position ${pos.data.positionId} - skipping`)
              continue
            }

            console.log(`[useMyPositions] Found event data for position ${pos.data.positionId}`)
            console.log(`[useMyPositions] DEBUG - Verifying ownership:`)
            console.log(`  stealthAddress (beneficiaryCommitment): ${beneficiaryCommitment.toBase58().slice(0, 16)}...`)
            console.log(`  ephemeralPubkey: ${eventData.ephemeralPubkey.slice(0, 16)}...`)
            console.log(`  metaSpendPub: ${metaSpendPub.slice(0, 16)}...`)
            console.log(`  viewPrivKeyHex: ${cachedKeys.viewPrivKeyHex.slice(0, 16)}...`)

            // Verify ownership using stealth verification
            // Parameter order: viewPrivHex, spendPub58, ephPub58, stealthAddress
            const isMine = await isMyStealthPayment(
              cachedKeys.viewPrivKeyHex,
              metaSpendPub,
              eventData.ephemeralPubkey,
              beneficiaryCommitment
            )

            console.log(`[useMyPositions] isMyStealthPayment result: ${isMine}`)

            if (!isMine) {
              console.log(`[useMyPositions] Position ${pos.data.positionId} does not belong to us - skipping`)
              continue
            }

            console.log(`[useMyPositions] ✓ VERIFIED MY POSITION: ${pos.data.positionId}`)

            // Build position data
            const startTimestamp = pos.data.startTimestamp
            const isFullyClaimed = pos.data.isFullyClaimed === 1
            const isActive = pos.data.isActive === 1

            // Determine claim status from compressed position data (Option C)
            // If isFullyClaimed=true, position is claimed
            // If isActive=false and not fully claimed, might be partially claimed (for production streaming)
            let claimStatus: ClaimStatus = 'unclaimed'
            if (isFullyClaimed) {
              claimStatus = 'claimed'
            } else if (!isActive) {
              // Position inactive but not fully claimed - might be error state
              claimStatus = 'unknown'
            }

            console.log(`[useMyPositions] Position ${pos.data.positionId} claim status: ${claimStatus} (isFullyClaimed=${isFullyClaimed}, isActive=${isActive})`)

            const onChainData: OnChainPositionData = {
              owner: pos.data.owner.toBase58(),
              organization: pos.data.organization.toBase58(),
              schedule: pos.data.schedule.toBase58(),
              positionId: pos.data.positionId,
              beneficiaryCommitment: beneficiaryCommitment.toBase58(),
              startTimestamp,
              isActive,
              isFullyClaimed,
              compressedAddress: pos.address.toBase58(),
              hash: new Uint8Array(0),
              treeInfo: { tree: '', queue: '' },
            }

            myPositions.push({
              id: `${org.publicKey.toBase58()}-${pos.data.positionId}`,
              pubkey: pos.address.toBase58(),
              positionId: pos.data.positionId,
              organizationPubkey: org.publicKey.toBase58(),
              tokenMint: org.account.tokenMint.toBase58(),
              scheduleIndex: 0,
              schedulePubkey: pos.data.schedule.toBase58(),
              stealthOwner: beneficiaryCommitment.toBase58(),
              ephemeralPub: eventData.ephemeralPubkey,
              encryptedEphemeralPayload: eventData.encryptedPayload,
              isCompressed: true,
              startTimestamp: startTimestamp.toString(),
              cliffEndTime: startTimestamp,
              vestingEndTime: startTimestamp,
              vestingProgress: 100,
              status: 'vested',
              isInCliff: false,
              isFullyVested: true,
              isActive,
              claimStatus,
              receivedVia: null,
              onChainData,
              verificationStatus: 'verified',
            })
          } catch (err) {
            console.warn(`[useMyPositions] Error processing position ${pos.data.positionId}:`, err)
          }
        }
      }

      console.log(`[useMyPositions] === DISCOVERY COMPLETE: Found ${myPositions.length} positions ===`)
      setPositions(myPositions)
    } catch (err) {
      console.error('[useMyPositions] On-chain scan failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to scan positions')
    } finally {
      setLoading(false)
    }
  }, [program, metaSpendPub])

  /**
   * Fetch on-chain compressed position data from Light Protocol
   * This is needed when claiming to get:
   * - Current state (encryptedClaimedAmount, isFullyClaimed, etc.)
   * - Account hash and tree info for validity proof
   *
   * Based on contract tests: compressed-claim-withdraw.ts, stealth-compressed-flow.ts
   */
  const fetchOnChainData = useCallback(async (position: MyPositionWithStats): Promise<CompressedPositionWithAccount | null> => {
    if (!position.isCompressed) {
      console.warn('fetchOnChainData is only for compressed positions')
      return null
    }

    try {
      const lightRpc = createLightRpc(LIGHT_RPC_ENDPOINT)
      const organizationPubkey = new PublicKey(position.organizationPubkey)

      // Fetch compressed position from Light Protocol with full account info
      // This returns: data, address, hash, treeInfo - everything needed for claims
      const result = await fetchCompressedPositionForClaim(
        lightRpc,
        organizationPubkey,
        position.positionId,
        PROGRAM_ID
      )

      if (result) {
        console.log('Fetched on-chain compressed position:')
        console.log('  Address:', result.address.toString())
        console.log('  Position ID:', result.data.positionId)
        console.log('  Is Active:', result.data.isActive)
        console.log('  Is Fully Claimed:', result.data.isFullyClaimed)
      }

      return result
    } catch (err) {
      console.error('Failed to fetch on-chain compressed data:', err)
      return null
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    positions,
    loading,
    error,
    refresh,
    fetchOnChainData,
  }
}

/**
 * @deprecated Use useMyPositions instead for stealth compressed positions
 * Hook to fetch positions for an employee by their stealth keys
 * Uses the beneficiary commitment derived from meta-address
 * Note: This only works for OLD positions where beneficiaryCommitment = metaSpendPub
 */
export function useEmployeePositions(
  metaSpendPub: string | null,
  metaViewPub: string | null
): UsePositionsResult {
  // This hook is deprecated - use useMyPositions instead
  // Return empty for now to avoid breaking changes
  const [positions] = useState<PositionWithStats[]>([])
  const [loading] = useState(false)
  const [error] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    console.warn('useEmployeePositions is deprecated. Use useMyPositions instead.')
  }, [])

  useEffect(() => {
    if (metaSpendPub && metaViewPub) {
      console.warn('useEmployeePositions is deprecated. Use useMyPositions instead.')
    }
  }, [metaSpendPub, metaViewPub])

  return {
    positions,
    loading,
    error,
    refresh,
  }
}
