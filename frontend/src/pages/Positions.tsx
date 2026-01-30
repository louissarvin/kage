import type { FC } from 'react'
import { useState, useRef, useLayoutEffect, useMemo, useCallback } from 'react'
import { PublicKey } from '@solana/web3.js'
import gsap from 'gsap'
import { Clock, Loader2, AlertCircle, CheckCircle2, X, Info, TrendingUp, Wallet } from 'lucide-react'
import { Card, CardContent, Button, Badge } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress, formatTimestamp, formatDuration } from '@/lib/constants'
import { useAuth } from '@/contexts/AuthContext'
import { useEmployeePositions, type PositionWithStats } from '@/hooks'
import { api, type VestingProgressInfo } from '@/lib/api'

// =============================================================================
// Types
// =============================================================================

type VestingStatus = 'cliff' | 'active' | 'vested' | 'completed'

interface PositionDisplayData {
  publicKey: PublicKey
  positionId: number
  organization: PublicKey
  startTimestamp: number
  isActive: boolean
  vestingProgress: number
  status: VestingStatus
  cliffEndTime: number
  vestingEndTime: number
  isFullyVested: boolean
}

// =============================================================================
// Helper Functions
// =============================================================================

function getVestingStatus(
  position: PositionWithStats,
  currentTime: number
): VestingStatus {
  const { stats, account } = position

  // If not active or fully claimed
  if (!account.isActive) {
    return 'completed'
  }

  // If fully vested
  if (stats.isFullyVested) {
    return 'vested'
  }

  // If still in cliff period
  if (currentTime < stats.cliffEndTime) {
    return 'cliff'
  }

  // Actively vesting
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
    case 'completed':
      return { variant: 'default', label: 'Completed' }
  }
}

// =============================================================================
// Main Component
// =============================================================================

export const Positions: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'cliff' | 'vested'>('all')
  const [selectedPosition, setSelectedPosition] = useState<PositionDisplayData | null>(null)
  const [showClaimModal, setShowClaimModal] = useState(false)

  // Get user's stealth keys from auth context
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()

  // Extract stealth keys from user's wallet
  const metaSpendPub = user?.wallets[0]?.metaSpendPub ?? null
  const metaViewPub = user?.wallets[0]?.metaViewPub ?? null
  const hasStealthKeys = !!metaSpendPub && !!metaViewPub

  // Fetch positions using employee's commitment
  const { positions, loading, error, refresh } = useEmployeePositions(
    metaSpendPub,
    metaViewPub
  )

  // Transform positions for display
  const currentTime = useMemo(() => Math.floor(Date.now() / 1000), [])

  const displayPositions: PositionDisplayData[] = useMemo(() => {
    return positions.map((pos) => ({
      publicKey: pos.publicKey,
      positionId: pos.account.positionId.toNumber(),
      organization: pos.account.organization,
      startTimestamp: pos.account.startTimestamp.toNumber(),
      isActive: pos.account.isActive,
      vestingProgress: pos.stats.vestingProgress,
      status: getVestingStatus(pos, currentTime),
      cliffEndTime: pos.stats.cliffEndTime,
      vestingEndTime: pos.stats.vestingEndTime,
      isFullyVested: pos.stats.isFullyVested,
    }))
  }, [positions, currentTime])

  // Filter positions
  const filteredPositions = useMemo(() => {
    return displayPositions.filter((pos) => {
      if (filter === 'all') return true
      if (filter === 'active') return pos.status === 'active'
      if (filter === 'cliff') return pos.status === 'cliff'
      if (filter === 'vested') return pos.status === 'vested' || pos.status === 'completed'
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

  // Loading state
  if (authLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 text-kage-accent animate-spin" />
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
          <div className="pos-section grid grid-cols-2 md:grid-cols-4 gap-4">
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
          </div>
        )}

        {/* Filters */}
        <div className="pos-section flex gap-2">
          {(['all', 'active', 'cliff', 'vested'] as const).map((f) => (
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
              {f === 'vested' ? 'Vested' : f.charAt(0).toUpperCase() + f.slice(1)}
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
              <h3 className="font-medium text-kage-text">
                Position #{position.positionId}
              </h3>
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
                position.status === 'cliff'
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
            Token amounts are encrypted via Arcium MPC for privacy. Submit a claim to reveal your claimable amount.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="primary"
            className="flex-1"
            disabled={position.status === 'cliff'}
            onClick={() => onClaimClick(position)}
          >
            {position.status === 'cliff' ? 'In Cliff Period' : 'Claim Tokens'}
          </Button>
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vestingInfo, setVestingInfo] = useState<VestingProgressInfo | null>(null)
  const [fetchingProgress, setFetchingProgress] = useState(true)

  // Fetch live vesting progress from backend
  useLayoutEffect(() => {
    const fetchProgress = async () => {
      try {
        setFetchingProgress(true)
        const progress = await api.getVestingProgress({
          organizationPubkey: position.organization.toBase58(),
          positionId: position.positionId,
        })
        setVestingInfo(progress)
      } catch (err) {
        console.error('Failed to fetch vesting progress:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch vesting info')
      } finally {
        setFetchingProgress(false)
      }
    }

    fetchProgress()
  }, [position])

  const handleClaim = async () => {
    setLoading(true)
    setError(null)

    try {
      // For MVP, show a message that full claim flow requires stealth key management
      // In production, this would:
      // 1. Generate nullifier
      // 2. Sign message with stealth private key
      // 3. Build Ed25519 verify instruction + authorize_claim instruction
      // 4. Call queue_process_claim with MPC encryption
      // 5. Wait for MPC callback
      // 6. Call withdraw

      setError('Claim functionality requires stealth key management. This feature will be available in the next release.')

    } catch (err) {
      console.error('Claim error:', err)
      setError(err instanceof Error ? err.message : 'Failed to process claim')
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

                {!vestingInfo?.isInCliff && !vestingInfo?.isFullyVested && (
                  <div className="col-span-2 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-green-400">Actively Vesting</span>
                    </div>
                    <p className="text-sm text-green-300">
                      {vestingInfo ? formatDuration(vestingInfo.timeUntilFullyVested) : 'Calculating...'} until fully vested
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
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleClaim}
              disabled={loading || position.status === 'cliff' || fetchingProgress}
            >
              {loading ? (
                <>
                  Processing...
                </>
              ) : (
                <>
                  Claim Tokens
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
