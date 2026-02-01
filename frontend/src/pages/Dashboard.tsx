import type { FC } from 'react'
import { useState, useRef, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import gsap from 'gsap'
import {
  ArrowRight,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { Card, CardContent, Button } from '@/components/ui'
import { Layout } from '@/components/layout'
import { EmployeeSetup } from '@/components/EmployeeSetup'
import { formatAddress, formatAmount } from '@/lib/constants'
import { useOrganization, usePositions, usePositionAggregates } from '@/hooks'
import { useAuth } from '@/contexts/AuthContext'

export const Dashboard: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { publicKey, connected } = useWallet()
  const { user, role, isAuthenticated, isLoading: authLoading, error: authError } = useAuth()
  const { organization, organizationData: _organizationData, stats: _stats, loading: orgLoading, error: orgError } = useOrganization()
  const { positions, loading: posLoading } = usePositions(organization)
  const aggregates = usePositionAggregates(positions)

  const loading = orgLoading || posLoading || authLoading

  // Format BN values for display
  const formatBN = (bn: { toString: () => string } | null, decimals = 9) => {
    if (!bn) return '0'
    return formatAmount(Number(bn.toString()), decimals)
  }

  const statsData = [
    {
      label: 'Active Positions',
      value: aggregates.activePositions.toString(),
      change: null,
    },
    {
      label: 'Total Vested',
      value: formatBN(aggregates.totalVested),
      subtext: 'tokens',
    },
    {
      label: 'Claimable',
      value: formatBN(aggregates.totalClaimable),
      subtext: 'tokens',
    },
  ]

  // GSAP page animation
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
      )
      // Stagger children
      gsap.fromTo(
        '.dashboard-section',
        { opacity: 0, y: 15 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, ease: 'power2.out', delay: 0.1 }
      )
    }, containerRef)
    return () => ctx.revert()
  }, [connected, isAuthenticated])

  if (!connected) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[80vh] text-center">
          <h1 className="text-2xl font-semibold text-kage-text mb-2">
            Connect Your Wallet
          </h1>
          <p className="text-kage-text-muted max-w-md">
            Connect your Solana wallet to access your dashboard and manage your vesting positions.
          </p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div ref={containerRef} className="space-y-8">
        {/* Welcome */}
        <div className="dashboard-section">
          <h1 className="text-2xl font-semibold text-kage-text">Dashboard</h1>
          <p className="mt-1 text-kage-text-muted">
            Connected as{' '}
            <span className="font-mono text-kage-text-dim">
              {publicKey ? formatAddress(publicKey.toBase58(), 6) : ''}
            </span>
          </p>
        </div>

        {/* Auth status */}
        {authLoading ? (
          <div className="dashboard-section">
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-sm text-kage-text-muted mt-2">Authenticating...</p>
              </CardContent>
            </Card>
          </div>
        ) : authError ? (
          <div className="dashboard-section p-4 rounded-2xl bg-red-500/10">
            <div className="flex items-center gap-3">
              <p className="text-sm text-red-400">{authError}</p>
            </div>
          </div>
        ) : isAuthenticated && role ? (
          <div className="dashboard-section">
            <RoleCard role={role} user={user} />
          </div>
        ) : null}

        {/* Error display */}
        {orgError && (
          <div className="p-4 rounded-2xl bg-red-500/10">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <p className="text-sm text-red-400">{orgError}</p>
            </div>
          </div>
        )}

        {/* Role-based content */}
        {isAuthenticated && role && (
          <>
            {/* Show employee setup if: NONE role OR stealth keys not set */}
            {(role.role === 'NONE' || !user?.wallets[0]?.metaSpendPub) && (
              <div className="dashboard-section">
                <h2 className="text-lg font-medium text-kage-text mb-4">
                  {role.role === 'NONE' ? 'Get Started' : 'Complete Setup'}
                </h2>
                <EmployeeSetup />
              </div>
            )}

            {/* EMPLOYEE or BOTH - show positions stats */}
            {(role.role === 'EMPLOYEE' || role.role === 'BOTH') && (
              <>
                {/* Stats */}
                <div className="dashboard-section grid grid-cols-1 md:grid-cols-3 gap-4">
                  {statsData.map((stat) => {
                    return (
                      <Card key={stat.label}>
                        <CardContent className="flex items-start justify-between">
                          <div>
                            <p className="text-sm text-kage-text-muted">
                              {stat.label}
                            </p>
                            <div className="mt-2 flex items-baseline gap-2">
                              {loading ? (
                                <Loader2 className="w-6 h-6 text-kage-text-dim animate-spin" />
                              ) : (
                                <>
                                  <span className="text-3xl font-semibold text-kage-text">
                                    {stat.value}
                                  </span>
                                  {stat.subtext && (
                                    <span className="text-sm text-kage-text-dim">
                                      {stat.subtext}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>

                {/* Recent positions */}
                <RecentPositions positions={positions} loading={loading} />
              </>
            )}

            {/* ADMIN or BOTH - show organization quick access */}
            {(role.role === 'ADMIN' || role.role === 'BOTH') && (
              <div className="dashboard-section">
                <Card>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div>
                          <h3 className="font-semibold text-kage-text">Your Organization</h3>
                          <p className="text-sm text-kage-text-muted">
                            Manage vesting schedules and positions
                          </p>
                        </div>
                      </div>
                      <Link to="/organizations">
                        <Button variant="secondary">
                          Manage
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}

        {/* Not authenticated - show basic stats */}
        {!isAuthenticated && (
          <div className="dashboard-section grid grid-cols-1 md:grid-cols-3 gap-4">
            {statsData.map((stat) => {
              return (
                <Card key={stat.label}>
                  <CardContent className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-kage-text-muted">
                        {stat.label}
                      </p>
                      <div className="mt-2 flex items-baseline gap-2">
                        {loading ? (
                          <Loader2 className="w-6 h-6 text-kage-text-dim animate-spin" />
                        ) : (
                          <>
                            <span className="text-3xl font-semibold text-kage-text">
                              {stat.value}
                            </span>
                            {stat.subtext && (
                              <span className="text-sm text-kage-text-dim">
                                {stat.subtext}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}

// Role display card
interface RoleCardProps {
  role: {
    role: string
    isAdmin: boolean
    isEmployee: boolean
    links: Array<{ id: string; slug: string; positionsReceived: number }>
    positionsCount: number
  }
  user: {
    wallets: Array<{ address: string; metaSpendPub: string | null }>
  } | null
}

const RoleCard: FC<RoleCardProps> = ({ role, user }) => {
  const hasStealthKeys = user?.wallets[0]?.metaSpendPub != null

  return (
    <Card>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {/* Role badge */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-kage-subtle">
            <div>
              <p className="text-xs text-kage-text-muted">Role</p>
              <p className="font-medium text-kage-text">{role.role}</p>
            </div>
          </div>

          {/* Links */}
          {role.links.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-kage-subtle">
              <div>
                <p className="text-xs text-kage-text-muted">Links</p>
                <p className="font-medium text-kage-text">{role.links.length}</p>
              </div>
            </div>
          )}

          {/* Stealth keys status */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-kage-subtle">
            <div>
              <p className="text-xs text-kage-text-muted">Stealth Keys</p>
              <p className="font-medium text-kage-text">
                {hasStealthKeys ? 'Registered' : 'Not Set'}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Recent Positions with pagination
interface RecentPositionsProps {
  positions: ReturnType<typeof usePositions>['positions']
  loading: boolean
}

const ITEMS_PER_PAGE = 5

const RecentPositions: FC<RecentPositionsProps> = ({ positions, loading }) => {
  const [currentPage, setCurrentPage] = useState(0)

  const totalPages = Math.ceil(positions.length / ITEMS_PER_PAGE)
  const canGoLeft = currentPage > 0
  const canGoRight = currentPage < totalPages - 1

  const paginatedPositions = positions.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

  return (
    <Card className="dashboard-section">
      <CardContent>
        {/* Header with pagination */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-kage-text">
            Recent Positions
            {positions.length > 0 && (
              <span className="text-kage-text-dim ml-2 text-sm font-normal">
                ({positions.length})
              </span>
            )}
          </h2>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 bg-kage-subtle rounded-full px-1 py-1">
              <button
                onClick={() => setCurrentPage(p => p - 1)}
                disabled={!canGoLeft}
                className={`w-8 h-8 rounded-full bg-kage-text-muted flex items-center justify-center hover:bg-kage-text transition-all duration-200 ${
                  canGoLeft ? 'opacity-100 scale-100' : 'opacity-0 scale-0 pointer-events-none'
                }`}
              >
                <svg className="w-4 h-4 text-kage-void" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={!canGoRight}
                className={`w-8 h-8 rounded-full bg-kage-text-muted flex items-center justify-center hover:bg-kage-text transition-all duration-200 ${
                  canGoRight ? 'opacity-100 scale-100' : 'opacity-0 scale-0 pointer-events-none'
                }`}
              >
                <svg className="w-4 h-4 text-kage-void" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-8 h-8 text-kage-text-dim animate-spin" />
          </div>
        ) : positions.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-kage-text-dim">No positions yet</p>
            <p className="text-sm text-kage-text-dim mt-1">
              Positions will appear here once created
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {paginatedPositions.map((pos) => {
              const isClaimed = pos.account.isFullyClaimed
              const statusText = isClaimed
                ? 'Claimed'
                : pos.account.isActive
                  ? 'Active'
                  : 'Inactive'
              const statusColor = isClaimed
                ? 'text-kage-text-dim'
                : pos.account.isActive
                  ? 'text-green-400'
                  : 'text-yellow-400'

              return (
                <div
                  key={pos.publicKey.toBase58()}
                  className={`p-4 rounded-lg bg-kage-elevated border border-kage-border-subtle ${isClaimed ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-kage-text">
                        Position #{pos.account.positionId.toString()}
                      </p>
                      <p className="text-sm text-kage-text-muted mt-1">
                        {pos.stats.vestingProgress}% vested
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${statusColor}`}>
                        {statusText}
                      </p>
                      <p className="text-xs text-kage-text-dim mt-1">
                        {isClaimed
                          ? 'Completed'
                          : pos.stats.vestingProgress >= 100
                            ? 'Ready to claim'
                            : 'Vesting'}
                      </p>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 h-1.5 bg-kage-subtle rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${isClaimed ? 'bg-kage-text-dim' : 'bg-kage-accent'}`}
                      style={{ width: `${pos.stats.vestingProgress}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
