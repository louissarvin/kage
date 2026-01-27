import type { FC } from 'react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Building2,
  Plus,
  Users,
  Calendar,
  ChevronRight,
  Search,
} from 'lucide-react'
import { Card, CardContent, CardHeader, Button, Badge, Input } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress } from '@/lib/constants'

// Mock data - replace with actual blockchain data
const mockOrganizations: {
  publicKey: string
  name?: string
  positionCount: number
  scheduleCount: number
  isActive: boolean
}[] = []

export const Organizations: FC = () => {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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
              Organizations
            </h1>
            <p className="mt-1 text-kage-text-muted">
              Manage your organizations and vesting schedules
            </p>
          </div>
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4" />
            Create Organization
          </Button>
        </motion.div>

        {/* Search */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-kage-text-dim" />
            <input
              type="text"
              placeholder="Search organizations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-kage-elevated border border-kage-border rounded-md text-kage-text placeholder:text-kage-text-dim focus:outline-none focus:border-kage-accent-dim transition-colors"
            />
          </div>
        </motion.div>

        {/* Organizations list */}
        {mockOrganizations.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardContent className="py-16 text-center">
                <div className="w-12 h-12 rounded-lg bg-kage-subtle mx-auto mb-4 flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-kage-text-dim" />
                </div>
                <h3 className="text-lg font-medium text-kage-text mb-2">
                  No organizations yet
                </h3>
                <p className="text-sm text-kage-text-muted mb-6 max-w-sm mx-auto">
                  Create your first organization to start setting up vesting
                  schedules for your team.
                </p>
                <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                  <Plus className="w-4 h-4" />
                  Create Organization
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {mockOrganizations.map((org, index) => (
              <motion.div
                key={org.publicKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.05 }}
              >
                <Card variant="interactive">
                  <CardContent className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-md bg-kage-accent-glow flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-kage-accent" />
                      </div>
                      <div>
                        <h3 className="font-medium text-kage-text">
                          {org.name || formatAddress(org.publicKey, 8)}
                        </h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-kage-text-muted">
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {org.positionCount} positions
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {org.scheduleCount} schedules
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={org.isActive ? 'success' : 'default'}>
                        {org.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      <ChevronRight className="w-5 h-5 text-kage-text-dim" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {/* Create modal */}
        {showCreateModal && (
          <CreateOrganizationModal onClose={() => setShowCreateModal(false)} />
        )}
      </div>
    </Layout>
  )
}

interface CreateOrganizationModalProps {
  onClose: () => void
}

const CreateOrganizationModal: FC<CreateOrganizationModalProps> = ({
  onClose,
}) => {
  const [name, setName] = useState('')
  const [tokenMint, setTokenMint] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    setLoading(true)
    // TODO: Implement organization creation
    setTimeout(() => {
      setLoading(false)
      onClose()
    }, 1000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-kage-void/80"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-md mx-4"
      >
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-kage-text">
              Create Organization
            </h2>
            <p className="text-sm text-kage-text-muted">
              Set up a new organization for vesting management
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Organization Name"
              placeholder="Acme Corp"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              label="Token Mint Address"
              placeholder="Enter SPL token mint address"
              value={tokenMint}
              onChange={(e) => setTokenMint(e.target.value)}
              hint="The SPL token used for vesting payments"
            />
            <div className="flex gap-3 pt-4">
              <Button variant="ghost" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreate}
                loading={loading}
                disabled={!name || !tokenMint}
                className="flex-1"
              >
                Create
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
