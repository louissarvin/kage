import type { FC } from 'react'
import { useRef, useLayoutEffect } from 'react'
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
import { formatAddress, formatAmount } from '@/lib/constants'
import { useOrganization, usePositions, usePositionAggregates } from '@/hooks'

export const Dashboard: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { publicKey, connected } = useWallet()
  const { organization, organizationData: _organizationData, stats: _stats, loading: orgLoading, error: orgError } = useOrganization()
  const { positions, loading: posLoading } = usePositions(organization)
  const aggregates = usePositionAggregates(positions)

  const loading = orgLoading || posLoading

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
  }, [connected])

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

        {/* Error display */}
        {orgError && (
          <div className="p-4 rounded-2xl bg-red-500/10">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <p className="text-sm text-red-400">{orgError}</p>
            </div>
          </div>
        )}

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
        <Card className="dashboard-section">
            <CardContent>
              <h2 className="text-lg font-medium text-kage-text mb-4">
                Recent Positions
              </h2>
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
                  {positions.slice(0, 5).map((pos) => (
                    <div
                      key={pos.publicKey.toBase58()}
                      className="p-4 rounded-lg bg-kage-elevated border border-kage-border-subtle"
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
                          <p className="text-sm text-kage-text">
                            {formatBN(pos.stats.claimableAmount)} claimable
                          </p>
                          <p className="text-xs text-kage-text-dim mt-1">
                            of {formatBN(pos.account.totalAmount)} total
                          </p>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-3 h-1.5 bg-kage-subtle rounded-full overflow-hidden">
                        <div
                          className="h-full bg-kage-accent rounded-full transition-all duration-500"
                          style={{ width: `${pos.stats.vestingProgress}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {positions.length > 5 && (
                    <Link to="/positions">
                      <Button variant="ghost" className="w-full">
                        View all {positions.length} positions
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
      </div>
    </Layout>
  )
}
