import type { FC } from 'react'
import { useState, useRef, useLayoutEffect, useMemo, useCallback } from 'react'
import {
  PublicKey,
  Ed25519Program,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  AddressLookupTableProgram,
} from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import gsap from 'gsap'
import { Clock, Loader2, AlertCircle, X } from 'lucide-react'
import { Card, CardContent, Button, Badge } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress, formatTimestamp, formatDuration } from '@/lib/constants'
import { useAuth } from '@/contexts/AuthContext'
import { useMyPositions, useVaultKeys, type ClaimStatus } from '@/hooks'
import { useProgram } from '@/hooks/useProgram'
import { api, type VestingProgressInfo } from '@/lib/api'
import {
  createLightRpc,
  buildLightRemainingAccountsFromTrees,
  serializeValidityProof,
  serializeCompressedAccountMeta,
  parseCompressedPositionData,
  deriveCompressedPositionAddress,
  BN,
  bn,
  findClaimAuthorizationPda,
  findNullifierPda,
  fetchOrganization,
  PROGRAM_ID,
} from '@/lib/sdk'
import {
  deriveStealthKeypair,
  decryptEphemeralPrivKey,
  createNullifier,
} from '@/lib/stealth-address'
import { defaultTestStateTreeAccounts } from '@lightprotocol/stateless.js'

// Light Protocol RPC endpoint
const LIGHT_RPC_ENDPOINT = import.meta.env.VITE_HELIUS_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=YOUR_KEY'

// =============================================================================
// Types
// =============================================================================

type VestingStatus = 'cliff' | 'active' | 'vested' | 'completed' | 'claimed'

/**
 * Position display data combining database info and derived status
 * Uses MyPositionWithStats from useMyPositions hook as the source
 */
interface PositionDisplayData {
  // From database (via useMyPositions)
  id: string
  pubkey: string
  positionId: number
  organizationPubkey: string
  tokenMint: string
  scheduleIndex: number
  stealthOwner: string
  ephemeralPub: string
  encryptedEphemeralPayload: string | null
  isCompressed: boolean
  startTimestamp: number
  cliffEndTime: number
  vestingEndTime: number
  vestingProgress: number
  isFullyVested: boolean
  isActive: boolean
  // Claim status
  claimStatus: ClaimStatus
  // Derived
  status: VestingStatus
  organization: PublicKey
  publicKey: PublicKey
  // On-chain data from Light Protocol
  onChainData?: {
    beneficiaryCommitment: string
    compressedAddress: string
    startTimestamp: number
    isActive: boolean
    isFullyClaimed: boolean
  }
  verificationStatus: 'verified' | 'mismatch' | 'not_found' | 'error' | 'pending'
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert status string from API to VestingStatus
 * Also considers claimStatus for already-claimed positions
 */
function convertStatus(
  apiStatus: 'cliff' | 'vesting' | 'vested',
  isActive: boolean,
  claimStatus?: ClaimStatus
): VestingStatus {
  // If position is claimed, show claimed status
  if (claimStatus === 'claimed') {
    return 'claimed'
  }
  if (!isActive) {
    return 'completed'
  }
  if (apiStatus === 'cliff') return 'cliff'
  if (apiStatus === 'vested') return 'vested'
  return 'active'
}

function getStatusBadgeProps(status: VestingStatus): {
  variant: 'success' | 'warning' | 'default' | 'accent'
  label: string
} {
  switch (status) {
    case 'cliff':
      return { variant: 'warning', label: 'Cliff Period' }
    case 'active':
      return { variant: 'success', label: 'Active' }
    case 'vested':
      return { variant: 'accent', label: 'Fully Vested' }
    case 'claimed':
      return { variant: 'default', label: 'Claimed' }
    case 'completed':
      return { variant: 'default', label: 'Completed' }
  }
}

// =============================================================================
// Main Component
// =============================================================================

export const Positions: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'cliff' | 'vested' | 'claimed'>('all')
  const [selectedPosition, setSelectedPosition] = useState<PositionDisplayData | null>(null)
  const [showClaimModal, setShowClaimModal] = useState(false)

  // Get user's stealth keys from auth context
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()

  // Extract stealth keys from user's wallet
  const metaSpendPub = user?.wallets[0]?.metaSpendPub ?? null
  const metaViewPub = user?.wallets[0]?.metaViewPub ?? null
  const hasStealthKeys = !!metaSpendPub && !!metaViewPub

  // Vault keys for position discovery - auto-retrieve from Arcium vault
  const {
    hasKeys: hasVaultKeys,
    isLoading: vaultKeysLoading,
    error: vaultKeysError,
    status: vaultKeysStatus,
    retrieveKeys,
  } = useVaultKeys()

  // Auto-retrieve vault keys when page loads (needed for position ownership verification)
  useLayoutEffect(() => {
    if (hasStealthKeys && !hasVaultKeys && !vaultKeysLoading && vaultKeysStatus === 'idle') {
      console.log('[Positions] Auto-retrieving vault keys for position discovery...')
      retrieveKeys()
    }
  }, [hasStealthKeys, hasVaultKeys, vaultKeysLoading, vaultKeysStatus, retrieveKeys])

  // Fetch positions from on-chain (Light Protocol + ownership verification)
  // Only runs after vault keys are available for ownership verification
  const { positions, loading, error, refresh, fetchOnChainData: _fetchOnChainData } = useMyPositions(metaSpendPub)

  // Transform positions for display
  const displayPositions: PositionDisplayData[] = useMemo(() => {
    return positions.map((pos) => ({
      // From database
      id: pos.id,
      pubkey: pos.pubkey,
      positionId: pos.positionId,
      organizationPubkey: pos.organizationPubkey,
      tokenMint: pos.tokenMint,
      scheduleIndex: pos.scheduleIndex,
      stealthOwner: pos.stealthOwner,
      ephemeralPub: pos.ephemeralPub,
      encryptedEphemeralPayload: pos.encryptedEphemeralPayload,
      isCompressed: pos.isCompressed,
      startTimestamp: parseInt(pos.startTimestamp, 10),
      cliffEndTime: pos.cliffEndTime,
      vestingEndTime: pos.vestingEndTime,
      vestingProgress: pos.vestingProgress,
      isFullyVested: pos.isFullyVested,
      isActive: pos.isActive,
      // Claim status from on-chain data
      claimStatus: pos.claimStatus,
      // Derived - pass claimStatus to determine if position is claimed
      status: convertStatus(pos.status, pos.isActive, pos.claimStatus),
      organization: new PublicKey(pos.organizationPubkey),
      publicKey: new PublicKey(pos.pubkey),
      // On-chain data from Light Protocol
      onChainData: pos.onChainData ? {
        beneficiaryCommitment: pos.onChainData.beneficiaryCommitment,
        compressedAddress: pos.onChainData.compressedAddress,
        startTimestamp: pos.onChainData.startTimestamp,
        isActive: pos.onChainData.isActive,
        isFullyClaimed: pos.onChainData.isFullyClaimed,
      } : undefined,
      verificationStatus: pos.verificationStatus,
    }))
  }, [positions])

  // Current time for calculating remaining durations
  const currentTime = useMemo(() => Math.floor(Date.now() / 1000), [])

  // Filter positions
  const filteredPositions = useMemo(() => {
    return displayPositions.filter((pos) => {
      if (filter === 'all') return true
      if (filter === 'active') return pos.status === 'active'
      if (filter === 'cliff') return pos.status === 'cliff'
      if (filter === 'vested') return pos.status === 'vested' || pos.status === 'completed'
      if (filter === 'claimed') return pos.status === 'claimed'
      return true
    })
  }, [displayPositions, filter])

  // Handle claim button click
  const handleClaimClick = useCallback((position: PositionDisplayData) => {
    setSelectedPosition(position)
    setShowClaimModal(true)
  }, [])

  // GSAP page animation
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
      )
      gsap.fromTo(
        '.pos-section',
        { opacity: 0, y: 15 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, ease: 'power2.out', delay: 0.1 }
      )
    }, containerRef)
    return () => ctx.revert()
  }, [])

  // Loading state - includes vault key retrieval
  if (authLoading || loading || vaultKeysLoading) {
    const statusMessage = vaultKeysLoading
      ? vaultKeysStatus === 'checking-vault' ? 'Checking vault...'
        : vaultKeysStatus === 'reading-vault' ? 'Reading keys from vault...'
        : vaultKeysStatus === 'waiting-event' ? 'Waiting for MPC decryption...'
        : vaultKeysStatus === 'decrypting' ? 'Decrypting stealth keys...'
        : 'Loading positions...'
      : 'Loading positions...'

    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Loader2 className="w-8 h-8 text-kage-accent animate-spin" />
          <p className="text-kage-text-muted text-sm">{statusMessage}</p>
        </div>
      </Layout>
    )
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <Layout>
        <div ref={containerRef} className="space-y-6">
          <Card>
            <CardContent className="py-16 text-center">
              <h3 className="text-xl font-semibold text-kage-text mb-2">
                Connect Wallet
              </h3>
              <p className="text-kage-text-muted max-w-md mx-auto">
                Connect your wallet and sign in to view your vesting positions.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    )
  }

  // No stealth keys registered
  if (!hasStealthKeys) {
    return (
      <Layout>
        <div ref={containerRef} className="space-y-6">
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 mx-auto mb-6 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-yellow-400" />
              </div>
              <h3 className="text-xl font-semibold text-kage-text mb-2">
                Complete Setup
              </h3>
              <p className="text-kage-text-muted max-w-md mx-auto mb-6">
                You need to register your stealth keys before you can receive vesting positions.
                Go to the Dashboard to complete your employee setup.
              </p>
              <Button variant="primary" onClick={() => window.location.href = '/dashboard'}>
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    )
  }

  // Vault key retrieval failed - show error with retry option
  if (vaultKeysError && !hasVaultKeys) {
    return (
      <Layout>
        <div ref={containerRef} className="space-y-6">
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 mx-auto mb-6 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-xl font-semibold text-kage-text mb-2">
                Failed to Retrieve Stealth Keys
              </h3>
              <p className="text-kage-text-muted max-w-md mx-auto mb-6">
                {vaultKeysError}
              </p>
              <div className="flex gap-4 justify-center">
                <Button variant="secondary" onClick={() => retrieveKeys()}>
                  Retry
                </Button>
                <Button variant="primary" onClick={() => window.location.href = '/dashboard'}>
                  Go to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div ref={containerRef} className="space-y-6">
        {/* Header */}
        <div className="pos-section flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-kage-text">
              Vesting Positions
            </h1>
            <p className="mt-1 text-kage-text-muted">
              View and manage your vesting positions
            </p>
          </div>
          <Button variant="secondary" onClick={refresh}>
            Refresh
          </Button>
        </div>

        {/* Error display */}
        {error && (
          <div className="pos-section p-4 rounded-2xl bg-red-500/10">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Stats Summary */}
        {displayPositions.length > 0 && (
          <div className="pos-section grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-4 rounded-xl bg-kage-elevated border border-kage-border-subtle">
              <p className="text-xs text-kage-text-muted mb-1">Total Positions</p>
              <p className="text-2xl font-semibold text-kage-text">{displayPositions.length}</p>
            </div>
            <div className="p-4 rounded-xl bg-kage-elevated border border-kage-border-subtle">
              <p className="text-xs text-kage-text-muted mb-1">Active</p>
              <p className="text-2xl font-semibold text-white">
                {displayPositions.filter(p => p.status === 'active').length}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-kage-elevated border border-kage-border-subtle">
              <p className="text-xs text-kage-text-muted mb-1">In Cliff</p>
              <p className="text-2xl font-semibold text-white">
                {displayPositions.filter(p => p.status === 'cliff').length}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-kage-elevated border border-kage-border-subtle">
              <p className="text-xs text-kage-text-muted mb-1">Fully Vested</p>
              <p className="text-2xl font-semibold text-white">
                {displayPositions.filter(p => p.status === 'vested' || p.status === 'completed').length}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-kage-elevated border border-kage-border-subtle">
              <p className="text-xs text-kage-text-muted mb-1">Claimed</p>
              <p className="text-2xl font-semibold text-white">
                {displayPositions.filter(p => p.status === 'claimed').length}
              </p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="pos-section flex gap-2 flex-wrap">
          {(['all', 'active', 'cliff', 'vested', 'claimed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`
                px-4 py-2 text-sm font-medium rounded-xl transition-colors
                ${
                  filter === f
                    ? 'bg-[#1a1a1a] text-kage-text'
                    : 'text-kage-text-dim hover:text-kage-text-muted'
                }
              `}
            >
              {f === 'vested' ? 'Vested' : f === 'claimed' ? 'Claimed' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Positions list */}
        {filteredPositions.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-kage-subtle mx-auto mb-6 flex items-center justify-center">
                <Clock className="w-8 h-8 text-kage-text-dim" />
              </div>
              <h3 className="text-lg font-medium text-kage-text mb-2">
                No vesting positions
              </h3>
              <p className="text-sm text-kage-text-muted max-w-sm mx-auto">
                {filter === 'all'
                  ? "You don't have any vesting positions yet. Positions will appear here when an organization assigns tokens to you."
                  : `No ${filter} positions found.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredPositions.map((position) => (
              <PositionCard
                key={position.publicKey.toBase58()}
                position={position}
                currentTime={currentTime}
                onClaimClick={handleClaimClick}
              />
            ))}
          </div>
        )}

        {/* Claim Modal */}
        {showClaimModal && selectedPosition && (
          <ClaimModal
            position={selectedPosition}
            onClose={() => {
              setShowClaimModal(false)
              setSelectedPosition(null)
            }}
          />
        )}
      </div>
    </Layout>
  )
}

// =============================================================================
// Position Card Component
// =============================================================================

interface PositionCardProps {
  position: PositionDisplayData
  currentTime: number
  onClaimClick: (position: PositionDisplayData) => void
}

const PositionCard: FC<PositionCardProps> = ({ position, currentTime, onClaimClick }) => {
  const statusProps = getStatusBadgeProps(position.status)

  // Calculate time remaining for cliff or vesting
  const getTimeInfo = () => {
    if (position.status === 'cliff') {
      const remaining = position.cliffEndTime - currentTime
      return {
        label: 'Cliff ends in',
        value: remaining > 0 ? formatDuration(remaining) : 'Ended',
      }
    }
    if (position.status === 'active') {
      const remaining = position.vestingEndTime - currentTime
      return {
        label: 'Fully vested in',
        value: remaining > 0 ? formatDuration(remaining) : 'Complete',
      }
    }
    return null
  }

  const timeInfo = getTimeInfo()

  return (
    <Card variant="interactive">
      <CardContent className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">

            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-kage-text">
                  Position #{position.positionId}
                </h3>
              </div>
              <p className="text-sm text-kage-text-muted font-mono">
                {formatAddress(position.organization.toBase58(), 8)}
              </p>
            </div>
          </div>
          <Badge variant={statusProps.variant}>
            {statusProps.label}
          </Badge>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-kage-text-muted">Vesting Progress</span>
            <span className="text-kage-text font-medium">{position.vestingProgress}%</span>
          </div>
          <div className="h-2 bg-kage-subtle rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                position.status === 'claimed'
                  ? 'bg-gray-500'
                  : position.status === 'cliff'
                    ? 'bg-yellow-500'
                    : position.status === 'vested' || position.status === 'completed'
                      ? 'bg-kage-accent'
                      : 'bg-green-500'
              }`}
              style={{ width: `${position.vestingProgress}%` }}
            />
          </div>
        </div>

        {/* Schedule Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
          <div className="flex items-start gap-2">
            <div>
              <p className="text-xs text-kage-text-dim">Start Date</p>
              <p className="text-sm text-kage-text">
                {formatTimestamp(position.startTimestamp)}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div>
              <p className="text-xs text-kage-text-dim">Cliff Ends</p>
              <p className="text-sm text-kage-text">
                {formatTimestamp(position.cliffEndTime)}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div>
              <p className="text-xs text-kage-text-dim">Fully Vested</p>
              <p className="text-sm text-kage-text">
                {formatTimestamp(position.vestingEndTime)}
              </p>
            </div>
          </div>
          {timeInfo && (
            <div className="flex items-start gap-2">
              <div>
                <p className="text-xs text-kage-text-dim">{timeInfo.label}</p>
                <p className="text-sm text-kage-accent font-medium">
                  {timeInfo.value}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Note about encrypted amounts */}
        <div className="p-3 rounded-xl bg-kage-subtle">
          <p className="text-xs text-kage-text-dim">
            {position.isCompressed ? (
              <>
                <span>Light Protocol compressed position.</span>{' '}
                Token amounts are encrypted via Arcium MPC for privacy. Submit a claim to reveal your claimable amount.
              </>
            ) : (
              'Token amounts are encrypted via Arcium MPC for privacy. Submit a claim to reveal your claimable amount.'
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          {position.status === 'claimed' ? (
            <Button
              variant="secondary"
              className="flex-1"
              disabled
            >
              Already Claimed
            </Button>
          ) : (
            <Button
              variant="primary"
              className="flex-1"
              disabled={position.status === 'cliff'}
              onClick={() => onClaimClick(position)}
            >
              {position.status === 'cliff' ? 'In Cliff Period' : 'Claim Tokens'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// =============================================================================
// Claim Modal Component
// =============================================================================

interface ClaimModalProps {
  position: PositionDisplayData
  onClose: () => void
}

const ClaimModal: FC<ClaimModalProps> = ({ position, onClose }) => {
  const { user } = useAuth()
  const program = useProgram()
  const {
    keys: vaultKeys,
    hasKeys: _hasCachedKeys,
    isLoading: vaultLoading,
    error: vaultError,
    status: _vaultStatus,
    retrieveKeys,
  } = useVaultKeys()

  const [loading, setLoading] = useState(false)
  const [claimStep, setClaimStep] = useState<'idle' | 'authorizing' | 'processing' | 'withdrawing' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [vestingInfo, setVestingInfo] = useState<VestingProgressInfo | null>(null)
  const [fetchingProgress, setFetchingProgress] = useState(true)
  const [claimTxSignature, setClaimTxSignature] = useState<string | null>(null)

  // Get stealth meta keys from user
  const wallet = user?.wallets[0]
  const metaSpendPub = wallet?.metaSpendPub
  const metaViewPub = wallet?.metaViewPub

  // Fetch live vesting progress from backend
  useLayoutEffect(() => {
    const fetchProgress = async () => {
      try {
        setFetchingProgress(true)
        const progress = await api.getVestingProgress({
          organizationPubkey: position.organization.toBase58(),
          positionId: position.positionId,
          isCompressed: position.isCompressed,
        })
        setVestingInfo(progress)
      } catch (err) {
        console.error('Failed to fetch vesting progress:', err)
        // Don't show error for progress fetch - it's optional
      } finally {
        setFetchingProgress(false)
      }
    }

    fetchProgress()
  }, [position])

  const handleClaim = async () => {
    if (!program || !metaSpendPub || !metaViewPub) {
      setError('Wallet not connected or stealth keys not found')
      return
    }

    setLoading(true)
    setError(null)
    setClaimStep('authorizing')

    try {
      if (position.isCompressed) {
        // ============================================
        // COMPRESSED POSITION CLAIM FLOW
        // ============================================
        console.log('Starting compressed position claim flow...')

        // Step 1: Get stealth private keys (from cache or vault)
        let cachedKeys = vaultKeys
        if (!cachedKeys) {
          console.log('Keys not cached, retrieving from vault...')
          cachedKeys = await retrieveKeys()
          if (!cachedKeys) {
            throw new Error(
              vaultError ||
              'Failed to retrieve stealth keys from vault. Please ensure your vault is set up.'
            )
          }
        }
        const stealthKeysResponse = {
          spendPrivKey: cachedKeys.spendPrivKeyHex,
          viewPrivKey: cachedKeys.viewPrivKeyHex,
        }

        // Step 2: Initialize Light RPC and fetch compressed position
        const lightRpc = createLightRpc(LIGHT_RPC_ENDPOINT)

        // Derive the compressed position address from organization + positionId
        // This ensures we use the same derivation as the contract
        const { address: compressedPositionAddress } = deriveCompressedPositionAddress(
          position.organization,
          position.positionId,
          PROGRAM_ID
        )
        console.log('Derived compressed position address:', compressedPositionAddress.toBase58())

        // Fetch the compressed account using the derived address
        const compressedAccount = await lightRpc.getCompressedAccount(
          bn(compressedPositionAddress.toBytes())
        )
        if (!compressedAccount) {
          throw new Error(
            `Compressed position not found at ${compressedPositionAddress.toBase58()}. ` +
            'The position may not be indexed yet. Please wait a few seconds and try again.'
          )
        }

        console.log('Compressed account found:', {
          hash: compressedAccount.hash.toString(),
          dataLength: compressedAccount.data?.data?.length,
          tree: compressedAccount.treeInfo.tree.toString(),
          queue: compressedAccount.treeInfo.queue.toString(),
        })

        // Step 3: Parse position data
        const positionData = parseCompressedPositionData(
          Buffer.from(compressedAccount.data!.data!)
        )
        console.log('Parsed position data:', {
          positionId: positionData.positionId,
          startTimestamp: positionData.startTimestamp,
          isActive: positionData.isActive,
          isFullyClaimed: positionData.isFullyClaimed,
        })

        // Step 4: Get ephemeral pubkey from position data (already fetched from database)
        // The database stores this when the position is created
        const ephemeralPubkey = position.ephemeralPub
        if (!ephemeralPubkey) {
          throw new Error(
            'Ephemeral key not found. This position may have been created before the stealth system was set up. ' +
            'Please contact the organization admin to recreate the position.'
          )
        }

        // Step 5: Get encrypted payload from position data
        const encryptedPayload = position.encryptedEphemeralPayload
        if (!encryptedPayload) {
          throw new Error(
            'Encrypted payload not found. This position was created before the privacy features were enabled. ' +
            'Please contact the organization admin to recreate the position with full privacy support.'
          )
        }

        console.log('Using stealth data from position:', {
          ephemeralPubkey: ephemeralPubkey.slice(0, 20) + '...',
          encryptedPayloadLength: encryptedPayload.length,
        })

        const ephPriv32 = await decryptEphemeralPrivKey(
          encryptedPayload,
          stealthKeysResponse.viewPrivKey,
          ephemeralPubkey
        )

        // Step 6: Derive stealth signing keypair
        const stealthSigner = await deriveStealthKeypair(
          stealthKeysResponse.spendPrivKey,
          metaViewPub,
          ephPriv32
        )

        console.log('Stealth signer derived:', stealthSigner.publicKey.toBase58())

        // Step 7: Create nullifier
        const nullifier = createNullifier(stealthSigner.publicKey, position.positionId)

        // Step 8: Create destination token account
        const orgData = await fetchOrganization(program, position.organization)
        if (!orgData) {
          throw new Error('Organization not found')
        }
        const tokenMint = orgData.tokenMint
        const destinationAta = await getAssociatedTokenAddress(
          tokenMint,
          program.provider.publicKey!
        )

        // Step 9: Build claim message and sign with stealth key
        const positionIdBytes = Buffer.alloc(8)
        positionIdBytes.writeBigUInt64LE(BigInt(position.positionId))
        const message = Buffer.concat([
          positionIdBytes,
          Buffer.from(nullifier),
          destinationAta.toBuffer(),
        ])

        const signature = await stealthSigner.signMessage(message)
        console.log('Claim message signed with stealth key')

        // Step 10: Create Ed25519 verify instruction
        const pubkeyBytes = stealthSigner.publicKey.toBytes()
        const messageBytes = new Uint8Array(message)
        console.log('Ed25519 instruction params:', {
          pubkeyLength: pubkeyBytes.length,
          messageLength: messageBytes.length,
          signatureLength: signature.length,
          pubkeyFirst5: Array.from(pubkeyBytes.slice(0, 5)),
          signatureFirst5: Array.from(signature.slice(0, 5)),
        })

        const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
          publicKey: pubkeyBytes,
          message: messageBytes,
          signature: signature,
        })

        // Step 11: Get validity proof
        const proof = await lightRpc.getValidityProofV0(
          [
            {
              hash: compressedAccount.hash,
              tree: compressedAccount.treeInfo.tree,
              queue: compressedAccount.treeInfo.queue,
            },
          ],
          []
        )

        // Step 12: Build remaining accounts
        const trees = defaultTestStateTreeAccounts()
        const remainingAccounts = buildLightRemainingAccountsFromTrees(
          [trees.merkleTree, trees.nullifierQueue],
          PROGRAM_ID
        )

        // Step 13: Serialize proof and account meta
        const proofBytes = serializeValidityProof(proof)
        // Use the derived compressed address, not the database pubkey
        const accountMetaBytes = serializeCompressedAccountMeta(proof, compressedPositionAddress)

        console.log('Authorize instruction data sizes:', {
          proofBytesLength: proofBytes.length,
          accountMetaBytesLength: accountMetaBytes.length,
          beneficiaryCommitmentLength: positionData.beneficiaryCommitment?.length,
          encryptedTotalAmountLength: positionData.encryptedTotalAmount?.length,
          encryptedClaimedAmountLength: positionData.encryptedClaimedAmount?.length,
          nullifierLength: nullifier.length,
          positionDataKeys: Object.keys(positionData),
        })

        // Step 14: Derive PDAs
        const [claimAuthPda] = findClaimAuthorizationPda(
          position.organization,
          position.positionId,
          nullifier
        )
        const [nullifierRecordPda] = findNullifierPda(
          position.organization,
          nullifier
        )

        // Step 14.5: Check if ClaimAuthorization already exists
        const connection = program.provider.connection
        const existingClaimAuth = await connection.getAccountInfo(claimAuthPda)

        if (existingClaimAuth) {
          console.log('ClaimAuthorization already exists, checking status...')

          // Try to fetch and check if already processed
          let claimAuthAccount = null
          try {
            claimAuthAccount = await (program.account as any).claimAuthorization.fetch(claimAuthPda)
          } catch (fetchErr) {
            console.log('Could not decode ClaimAuthorization account, may be invalid:', fetchErr)
            // Account exists but can't be decoded - this shouldn't happen normally
            // We'll throw an error rather than trying to recreate
            throw new Error(
              'ClaimAuthorization account exists but cannot be read. ' +
              'This may indicate a corrupted state. Please contact support.'
            )
          }

          if (claimAuthAccount.isProcessed) {
            // Claim was already fully processed
            throw new Error(
              'This position has already been claimed. The claim was processed successfully. ' +
              'Check your wallet for the received tokens.'
            )
          }

          // Authorization exists but not processed - queue claim processing
          // Backend now creates scratch positions in its own service organization
          console.log('ClaimAuthorization exists but not processed, queueing claim...')
          setClaimStep('processing')

          const scheduleIndex = 0 // Default to first schedule
          const MAX_CLAIM_AMOUNT = '18446744073709551615'

          // Queue claim processing - backend handles scratch position creation
          const result = await api.queueProcessClaim({
            organizationPubkey: position.organization.toBase58(),
            positionId: position.positionId,
            claimAuthPda: claimAuthPda.toBase58(),
            isCompressed: true,
            nullifier: Array.from(nullifier),
            destinationTokenAccount: destinationAta.toBase58(),
            claimAmount: MAX_CLAIM_AMOUNT,
            beneficiaryCommitment: Array.from(positionData.beneficiaryCommitment),
            scheduleIndex,
          })

          console.log('Claim processing result:', result)
          if (result.error) {
            throw new Error(result.error)
          }
          if (result.txSignatures?.length) {
            console.log('Claim transactions:', result.txSignatures)
          }

          setClaimStep('success')
          return // Exit early, claim flow completed
        }

        // Step 15: Build authorize claim instruction
        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })

        const authorizeIx = await program.methods
          .authorizeClaimCompressed(
            Buffer.from(proofBytes),
            Buffer.from(accountMetaBytes),
            positionData.owner,
            positionData.organization,
            positionData.schedule,
            new BN(positionData.positionId),
            Array.from(positionData.beneficiaryCommitment) as number[],
            Array.from(positionData.encryptedTotalAmount) as number[],
            Array.from(positionData.encryptedClaimedAmount) as number[],
            new BN(positionData.nonce.toString()),
            new BN(positionData.startTimestamp),
            positionData.isActive,
            positionData.isFullyClaimed,
            Array.from(nullifier) as number[],
            destinationAta
          )
          .accountsPartial({
            claimAuthorization: claimAuthPda,
            nullifierRecord: nullifierRecordPda,
            organization: position.organization,
            feePayer: program.provider.publicKey!,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(remainingAccounts)
          .instruction()

        // Step 16: Build versioned transaction with Address Lookup Table
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        // Collect all addresses for ALT
        const allAddresses = [
          claimAuthPda,
          nullifierRecordPda,
          position.organization,
          program.provider.publicKey!,
          SYSVAR_INSTRUCTIONS_PUBKEY,
          SystemProgram.programId,
          ...remainingAccounts.map(a => a.pubkey),
          PROGRAM_ID,
          Ed25519Program.programId,
          ComputeBudgetProgram.programId,
        ]

        // Try to find existing ALT or create one
        let lookupTableAccount = null
        try {
          // Check if there's a stored ALT for this organization
          const storedAltAddress = await api.getOrganizationALT(position.organization.toBase58())
          if (storedAltAddress) {
            const altAccountInfo = await connection.getAddressLookupTable(new PublicKey(storedAltAddress))
            if (altAccountInfo.value) {
              lookupTableAccount = altAccountInfo.value
              console.log('Using existing ALT:', storedAltAddress)
            }
          }
        } catch (err) {
          console.log('No existing ALT found, will create one')
        }

        // If no ALT exists, create one
        if (!lookupTableAccount) {
          console.log('Creating Address Lookup Table...')
          const recentSlot = await connection.getSlot('finalized')

          const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
            authority: program.provider.publicKey!,
            payer: program.provider.publicKey!,
            recentSlot,
          })

          const extendIx = AddressLookupTableProgram.extendLookupTable({
            payer: program.provider.publicKey!,
            authority: program.provider.publicKey!,
            lookupTable: lutAddress,
            addresses: allAddresses,
          })

          // Create ALT transaction
          const altTx = new VersionedTransaction(
            new TransactionMessage({
              payerKey: program.provider.publicKey!,
              recentBlockhash: blockhash,
              instructions: [createIx, extendIx],
            }).compileToV0Message()
          )

          if (!program.provider.wallet) {
            throw new Error('Wallet not connected')
          }
          const signedAltTx = await program.provider.wallet.signTransaction(altTx)
          const altTxSig = await connection.sendTransaction(signedAltTx, {
            skipPreflight: false,
          })

          console.log('ALT creation tx:', altTxSig)
          await connection.confirmTransaction({
            signature: altTxSig,
            blockhash,
            lastValidBlockHeight,
          }, 'confirmed')

          // Wait for ALT activation (1-2 slots)
          console.log('Waiting for ALT activation...')
          await new Promise(resolve => setTimeout(resolve, 2000))

          // Fetch the ALT account
          const altAccountInfo = await connection.getAddressLookupTable(lutAddress)
          if (!altAccountInfo.value) {
            throw new Error('Failed to fetch lookup table')
          }
          lookupTableAccount = altAccountInfo.value
          console.log('ALT created:', lutAddress.toBase58())

          // Store ALT address in backend for future use
          try {
            await api.setOrganizationALT(position.organization.toBase58(), lutAddress.toBase58())
          } catch (err) {
            console.log('Could not store ALT address:', err)
          }
        }

        // Build versioned transaction with ALT
        const instructions = [computeIx, priorityFeeIx, ed25519Ix, authorizeIx]
        const messageV0 = new TransactionMessage({
          payerKey: program.provider.publicKey!,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message([lookupTableAccount])

        const versionedTx = new VersionedTransaction(messageV0)

        console.log('Transaction details:', {
          numInstructions: messageV0.compiledInstructions.length,
          ed25519IxDataLength: ed25519Ix.data.length,
          authorizeIxDataLength: authorizeIx.data.length,
        })

        // Sign with wallet
        if (!program.provider.wallet) {
          throw new Error('Wallet not connected')
        }
        const signedTx = await program.provider.wallet.signTransaction(versionedTx)

        const txSig = await connection.sendTransaction(signedTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        })

        await connection.confirmTransaction({
          signature: txSig,
          blockhash,
          lastValidBlockHeight,
        }, 'confirmed')

        console.log('Claim authorized! Tx:', txSig)
        setClaimTxSignature(txSig)
        setClaimStep('processing')

        // Step 17: Queue MPC process_claim
        // Backend now creates scratch positions in its own service organization
        const scheduleIndex = 0 // Default to first schedule
        const MAX_CLAIM_AMOUNT = '18446744073709551615' // u64::MAX

        console.log('Queueing claim processing (backend handles scratch position)...')
        const result = await api.queueProcessClaim({
          organizationPubkey: position.organization.toBase58(),
          positionId: position.positionId,
          claimAuthPda: claimAuthPda.toBase58(),
          isCompressed: true,
          nullifier: Array.from(nullifier),
          destinationTokenAccount: destinationAta.toBase58(),
          claimAmount: MAX_CLAIM_AMOUNT,
          beneficiaryCommitment: Array.from(positionData.beneficiaryCommitment),
          scheduleIndex,
        })

        console.log('Claim processing result:', result)
        if (result.error) {
          throw new Error(result.error)
        }
        if (result.txSignatures?.length) {
          console.log('Claim transactions:', result.txSignatures)
        }

        setClaimStep('success')

      } else {
        // ============================================
        // REGULAR POSITION CLAIM FLOW (legacy)
        // ============================================
        setError('Regular position claim not yet implemented. Please use compressed positions.')
      }

    } catch (err) {
      console.error('Claim error:', err)
      setError(err instanceof Error ? err.message : 'Failed to process claim')
      setClaimStep('idle')
    } finally {
      setLoading(false)
    }
  }

  const statusProps = getStatusBadgeProps(position.status)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-kage-surface rounded-3xl border border-kage-border-subtle shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-kage-border-subtle">
          <div>
            <h2 className="text-xl font-semibold text-kage-text">
              Claim Vested Tokens
            </h2>
            <p className="text-sm text-kage-text-muted mt-1">
              Position #{position.positionId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-kage-subtle transition-colors"
          >
            <X className="w-5 h-5 text-kage-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {fetchingProgress ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 text-kage-secondary animate-spin" />
            </div>
          ) : (
            <>
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-kage-text-muted">Status</span>
                <Badge variant={statusProps.variant}>
                  {statusProps.label}
                </Badge>
              </div>

              {/* Progress Visualization */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-kage-text-muted">Vesting Progress</span>
                  <span className="text-lg font-semibold text-kage-secondary">
                    {vestingInfo?.vestingProgress ?? position.vestingProgress}%
                  </span>
                </div>
                <div className="h-3 bg-kage-subtle rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      position.status === 'cliff'
                        ? 'bg-yellow-500'
                        : position.status === 'vested'
                          ? 'bg-kage-secondary'
                          : 'bg-green-500'
                    }`}
                    style={{ width: `${vestingInfo?.vestingProgress ?? position.vestingProgress}%` }}
                  />
                </div>
              </div>

              {/* Vesting Details */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-kage-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-kage-text-muted">Start Date</span>
                  </div>
                  <p className="text-sm font-medium text-kage-text">
                    {vestingInfo?.startDate
                      ? new Date(vestingInfo.startDate).toLocaleDateString()
                      : formatTimestamp(position.startTimestamp)}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-kage-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-kage-text-muted">Fully Vested</span>
                  </div>
                  <p className="text-sm font-medium text-kage-text">
                    {vestingInfo?.vestingEndDate
                      ? new Date(vestingInfo.vestingEndDate).toLocaleDateString()
                      : formatTimestamp(position.vestingEndTime)}
                  </p>
                </div>

                {vestingInfo?.isInCliff && (
                  <div className="col-span-2 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-yellow-400">Cliff Period Active</span>
                    </div>
                    <p className="text-sm text-yellow-300">
                      {formatDuration(vestingInfo.timeUntilCliff)} remaining
                    </p>
                  </div>
                )}

                {vestingInfo?.isFullyVested && (
                  <div className="col-span-2 p-4 rounded-xl bg-kage-accent/10">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-kage-accent">Fully Vested</span>
                    </div>
                    <p className="text-sm text-kage-accent">
                      All tokens are available for claim
                    </p>
                  </div>
                )}
              </div>

              {/* Privacy Info */}
              <div className="p-4 rounded-xl bg-kage-subtle border border-kage-border-subtle">
                <div className="flex items-start gap-3">
                  <div>
                    <p className="text-sm text-kage-text-muted">
                      Your vesting amount is encrypted using Arcium MPC for privacy.
                      The actual token amount will be revealed during the claim process.
                    </p>
                  </div>
                </div>
              </div>

              {/* Claim Progress */}
              {claimStep !== 'idle' && claimStep !== 'success' && (
                <div className="p-4 rounded-xl bg-kage-accent/10 border border-kage-accent/20">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-kage-accent animate-spin" />
                    <div>
                      <p className="text-sm font-medium text-kage-accent">
                        {claimStep === 'authorizing' && 'Authorizing claim...'}
                        {claimStep === 'processing' && 'Processing MPC computation...'}
                        {claimStep === 'withdrawing' && 'Withdrawing tokens...'}
                      </p>
                      {claimTxSignature && (
                        <p className="text-xs text-kage-text-muted mt-1 font-mono">
                          Tx: {claimTxSignature.slice(0, 20)}...
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Success State */}
              {claimStep === 'success' && (
                <div className="p-4 rounded-xl bg-kage-subtle">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-sm font-medium text-kage-accent">
                        Claim submitted successfully
                      </p>
                      <p className="text-xs text-kage-text-muted mt-1">
                        Your tokens will be transferred after MPC verification.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-kage-border-subtle">
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onClose}
            >
              {claimStep === 'success' ? 'Close' : 'Cancel'}
            </Button>
            {claimStep !== 'success' && (
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleClaim}
                disabled={loading || vaultLoading || position.status === 'cliff' || fetchingProgress}
              >
                {loading || vaultLoading ? 'Processing...' : 'Claim Tokens'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
