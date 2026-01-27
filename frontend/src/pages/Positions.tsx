import type { FC } from 'react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, Unlock } from 'lucide-react'
import { Card, CardContent, Button, Badge } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress, formatTimestamp } from '@/lib/constants'

// Mock data - replace with actual blockchain data
const mockPositions: {
  publicKey: string
  organization: string
  positionId: number
  startTimestamp: number
  isActive: boolean
  isFullyClaimed: boolean
}[] = []

export const Positions: FC = () => {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')

  const filteredPositions = mockPositions.filter((pos) => {
    if (filter === 'all') return true
    if (filter === 'active') return pos.isActive && !pos.isFullyClaimed
    if (filter === 'completed') return pos.isFullyClaimed
    return true
  })

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div>
            <h1 className="text-2xl font-semibold text-kage-text">
              Vesting Positions
            </h1>
            <p className="mt-1 text-kage-text-muted">
              View and manage your vesting positions
            </p>
          </div>
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex gap-2"
        >
          {(['all', 'active', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                ${
                  filter === f
                    ? 'bg-kage-elevated text-kage-text'
                    : 'text-kage-text-dim hover:text-kage-text-muted'
                }
              `}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </motion.div>

        {/* Positions list */}
        {filteredPositions.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardContent className="py-16 text-center">
                <div className="w-12 h-12 rounded-lg bg-kage-subtle mx-auto mb-4 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-kage-text-dim" />
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
          </motion.div>
        ) : (
          <div className="space-y-4">
            {filteredPositions.map((position, index) => (
              <PositionCard
                key={position.publicKey}
                position={position}
                index={index}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

interface PositionCardProps {
  position: {
    publicKey: string
    organization: string
    positionId: number
    startTimestamp: number
    isActive: boolean
    isFullyClaimed: boolean
  }
  index: number
}

const PositionCard: FC<PositionCardProps> = ({ position, index }) => {
  const vestingProgress = 45 // Calculate from actual data

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.05 }}
    >
      <Card variant="interactive">
        <CardContent className="space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-kage-accent-glow flex items-center justify-center">
                <Clock className="w-5 h-5 text-kage-accent" />
              </div>
              <div>
                <h3 className="font-medium text-kage-text">
                  Position #{position.positionId}
                </h3>
                <p className="text-sm text-kage-text-muted">
                  {formatAddress(position.organization, 8)}
                </p>
              </div>
            </div>
            <Badge
              variant={
                position.isFullyClaimed
                  ? 'default'
                  : position.isActive
                    ? 'success'
                    : 'warning'
              }
            >
              {position.isFullyClaimed
                ? 'Completed'
                : position.isActive
                  ? 'Active'
                  : 'Paused'}
            </Badge>
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-kage-text-muted">Vesting Progress</span>
              <span className="text-kage-text">{vestingProgress}%</span>
            </div>
            <div className="h-2 bg-kage-subtle rounded-full overflow-hidden">
              <div
                className="h-full bg-kage-accent rounded-full transition-all duration-500"
                style={{ width: `${vestingProgress}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            <div>
              <p className="text-xs text-kage-text-dim">Start Date</p>
              <p className="text-sm text-kage-text mt-0.5">
                {formatTimestamp(position.startTimestamp)}
              </p>
            </div>
            <div>
              <p className="text-xs text-kage-text-dim">Vested</p>
              <p className="text-sm text-kage-text mt-0.5">
                <span className="text-kage-accent">---</span> tokens
              </p>
            </div>
            <div>
              <p className="text-xs text-kage-text-dim">Claimable</p>
              <p className="text-sm text-kage-text mt-0.5">
                <span className="text-kage-accent">---</span> tokens
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1">
              View Details
            </Button>
            <Button variant="primary" className="flex-1">
              <Unlock className="w-4 h-4" />
              Claim
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
