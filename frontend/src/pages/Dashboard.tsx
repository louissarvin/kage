import type { FC } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { motion } from 'framer-motion'
import {
  Building2,
  Clock,
  Shield,
  TrendingUp,
  ArrowRight,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { Card, CardContent, Button } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress, formatAmount } from '@/lib/constants'
import { useOrganization, usePositions, usePositionAggregates } from '@/hooks'

export const Dashboard: FC = () => {
  const { publicKey, connected } = useWallet()
  const { organization, organizationData, stats, loading: orgLoading, error: orgError } = useOrganization()
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
      icon: Clock,
    },
    {
      label: 'Total Vested',
      value: formatBN(aggregates.totalVested),
      subtext: 'tokens',
      icon: TrendingUp,
    },
    {
      label: 'Claimable',
      value: formatBN(aggregates.totalClaimable),
      subtext: 'tokens',
      icon: Shield,
    },
  ]

  if (!connected) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <div className="w-16 h-16 rounded-full bg-kage-subtle flex items-center justify-center mb-6">
            <Shield className="w-8 h-8 text-kage-text-dim" />
          </div>
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
      <div className="space-y-8">
        {/* Welcome */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl font-semibold text-kage-text">Dashboard</h1>
          <p className="mt-1 text-kage-text-muted">
            Connected as{' '}
            <span className="font-mono text-kage-text-dim">
              {publicKey ? formatAddress(publicKey.toBase58(), 6) : ''}
            </span>
          </p>
        </motion.div>

        {/* Error display */}
        {orgError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-lg bg-red-500/10 border border-red-500/20"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <p className="text-sm text-red-400">{orgError}</p>
            </div>
          </motion.div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {statsData.map((stat, index) => {
            const Icon = stat.icon
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
              >
                <Card>
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
                    <div className="p-2 rounded-md bg-kage-subtle">
                      <Icon className="w-5 h-5 text-kage-text-dim" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Employer section */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-kage-accent-glow">
                    <Building2 className="w-5 h-5 text-kage-accent" />
                  </div>
                  <div>
                    <h2 className="text-lg font-medium text-kage-text">
                      Employer
                    </h2>
                    <p className="text-sm text-kage-text-muted">
                      {organizationData
                        ? `Managing: ${organizationData.name}`
                        : 'Create an organization to get started'}
                    </p>
                  </div>
                </div>

                {/* Organization stats */}
                {stats && (
                  <div className="grid grid-cols-2 gap-3 py-2">
                    <div className="p-3 rounded-lg bg-kage-subtle">
                      <p className="text-xs text-kage-text-muted">Schedules</p>
                      <p className="text-lg font-semibold text-kage-text">
                        {stats.totalSchedules}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-kage-subtle">
                      <p className="text-xs text-kage-text-muted">Vault Balance</p>
                      <p className="text-lg font-semibold text-kage-text">
                        {stats.vaultBalance ? formatBN(stats.vaultBalance) : '---'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-2 space-y-3">
                  {!organizationData ? (
                    <Link to="/organizations/create">
                      <Button variant="secondary" className="w-full justify-between">
                        <span className="flex items-center gap-2">
                          <Plus className="w-4 h-4" />
                          Create Organization
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  ) : (
                    <Link to="/organizations">
                      <Button variant="secondary" className="w-full justify-between">
                        <span className="flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          Manage Organization
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  )}
                  <Link to="/organizations">
                    <Button variant="ghost" className="w-full justify-between">
                      View All Organizations
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Employee section */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 }}
          >
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-kage-accent-glow">
                    <Shield className="w-5 h-5 text-kage-accent" />
                  </div>
                  <div>
                    <h2 className="text-lg font-medium text-kage-text">
                      Employee
                    </h2>
                    <p className="text-sm text-kage-text-muted">
                      {aggregates.activePositions > 0
                        ? `${aggregates.activePositions} active position${aggregates.activePositions > 1 ? 's' : ''}`
                        : 'View positions and claim vested tokens'}
                    </p>
                  </div>
                </div>

                {/* Position summary */}
                {aggregates.activePositions > 0 && (
                  <div className="grid grid-cols-2 gap-3 py-2">
                    <div className="p-3 rounded-lg bg-kage-subtle">
                      <p className="text-xs text-kage-text-muted">Total Claimed</p>
                      <p className="text-lg font-semibold text-kage-text">
                        {formatBN(aggregates.totalClaimed)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-kage-accent-glow">
                      <p className="text-xs text-kage-text-muted">Ready to Claim</p>
                      <p className="text-lg font-semibold text-kage-accent">
                        {formatBN(aggregates.totalClaimable)}
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-2 space-y-3">
                  <Link to="/positions">
                    <Button variant="secondary" className="w-full justify-between">
                      <span className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        My Positions
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Link to="/claim">
                    <Button
                      variant={aggregates.totalClaimable.gtn(0) ? 'primary' : 'ghost'}
                      className="w-full justify-between"
                    >
                      Claim Tokens
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Recent positions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        >
          <Card>
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
        </motion.div>
      </div>
    </Layout>
  )
}
