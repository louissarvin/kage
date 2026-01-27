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
} from 'lucide-react'
import { Card, CardContent, Button } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress } from '@/lib/constants'

const stats = [
  {
    label: 'Active Positions',
    value: '0',
    change: null,
    icon: Clock,
  },
  {
    label: 'Total Vested',
    value: '0',
    subtext: 'tokens',
    icon: TrendingUp,
  },
  {
    label: 'Claimable',
    value: '0',
    subtext: 'tokens',
    icon: Shield,
  },
]

export const Dashboard: FC = () => {
  const { publicKey } = useWallet()

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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {stats.map((stat, index) => {
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
                        <span className="text-3xl font-semibold text-kage-text">
                          {stat.value}
                        </span>
                        {stat.subtext && (
                          <span className="text-sm text-kage-text-dim">
                            {stat.subtext}
                          </span>
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
                      Manage organizations and vesting schedules
                    </p>
                  </div>
                </div>

                <div className="pt-2 space-y-3">
                  <Link to="/organizations/create">
                    <Button variant="secondary" className="w-full justify-between">
                      <span className="flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        Create Organization
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Link to="/organizations">
                    <Button variant="ghost" className="w-full justify-between">
                      View Organizations
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
                      View positions and claim vested tokens
                    </p>
                  </div>
                </div>

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
                    <Button variant="ghost" className="w-full justify-between">
                      Claim Tokens
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Recent activity placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        >
          <Card>
            <CardContent>
              <h2 className="text-lg font-medium text-kage-text mb-4">
                Recent Activity
              </h2>
              <div className="py-12 text-center">
                <p className="text-kage-text-dim">No recent activity</p>
                <p className="text-sm text-kage-text-dim mt-1">
                  Activity will appear here once you start using Kage
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </Layout>
  )
}
