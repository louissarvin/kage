import type { FC } from 'react'
import { useState, useRef, useLayoutEffect } from 'react'
import { PublicKey } from '@solana/web3.js'
import gsap from 'gsap'
import {
  Building2,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, Button, Badge, Input, TokenSelect, DEVNET_TOKENS } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress, formatDuration } from '@/lib/constants'
import { useOrganization } from '@/hooks'
import { EmployeeLookup } from '@/components/EmployeeLookup'
import { BN } from '@/lib/sdk'

export const Organizations: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSchedulesModal, setShowSchedulesModal] = useState(false)
  const [showPositionsModal, setShowPositionsModal] = useState(false)

  // Fetch user's organization only (admin view)
  const { organization, organizationData, schedules, loading, error, refresh } = useOrganization()

  // GSAP page animation
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
      )
      gsap.fromTo(
        '.org-section',
        { opacity: 0, y: 15 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, ease: 'power2.out', delay: 0.1 }
      )
    }, containerRef)
    return () => ctx.revert()
  }, [])

  const handleModalClose = () => {
    setShowCreateModal(false)
    setShowSchedulesModal(false)
    setShowPositionsModal(false)
    refresh()
  }

  // Loading state
  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 text-kage-accent animate-spin" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div ref={containerRef} className="space-y-6">
        {/* Header */}
        <div className="org-section flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-kage-text">
              Organization
            </h1>
            <p className="mt-1 text-kage-text-muted">
              {organizationData ? 'Manage your organization and vesting schedules' : 'Create an organization to start managing vesting'}
            </p>
          </div>
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-5 h-5" />
            Create Organization
          </Button>
        </div>

        {/* Error display */}
        {error && (
          <div className="org-section p-4 rounded-2xl bg-red-500/10">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Organization Content */}
        {organizationData && organization ? (
          // Has organization - show management view
          <div className="org-section space-y-6">
            {/* Organization Card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">

                    <div>
                      <h2 className="text-xl font-semibold text-kage-text">
                        Your Organization
                      </h2>
                      <p className="text-sm text-kage-text-muted font-mono mt-1">
                        {formatAddress(organization.toBase58(), 12)}
                      </p>
                    </div>
                  </div>
                  <Badge variant={organizationData.isActive ? 'success' : 'default'} className="text-sm">
                    {organizationData.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <div className="p-4 rounded-xl bg-kage-subtle">
                    <div className="flex items-center gap-2 text-kage-text-muted mb-1">
                      <span className="text-xs">Positions</span>
                    </div>
                    <p className="text-2xl font-semibold text-kage-text">
                      {organizationData.positionCount.toString()}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-kage-subtle">
                    <div className="flex items-center gap-2 text-kage-text-muted mb-1">
                      <span className="text-xs">Schedules</span>
                    </div>
                    <p className="text-2xl font-semibold text-kage-text">
                      {organizationData.scheduleCount.toString()}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-kage-subtle">
                    <div className="flex items-center gap-2 text-kage-text-muted mb-1">
                      <span className="text-xs">Token Mint</span>
                    </div>
                    <p className="text-sm font-mono text-kage-text truncate">
                      {formatAddress(organizationData.tokenMint.toBase58(), 8)}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-kage-subtle">
                    <div className="flex items-center gap-2 text-kage-text-muted mb-1">
                      <span className="text-xs">Treasury</span>
                    </div>
                    <p className="text-sm font-mono text-kage-text truncate">
                      {formatAddress(organizationData.treasury.toBase58(), 8)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-6">
                  <Button variant="secondary" className="flex-1" onClick={() => setShowSchedulesModal(true)}>
                    Manage Schedules
                  </Button>
                  <Button variant="secondary" className="flex-1" onClick={() => setShowPositionsModal(true)}>
                    Manage Positions
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          // No organization - show create prompt
          <div className="org-section">
            <Card>
              <CardContent className="py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-kage-subtle mx-auto mb-6 flex items-center justify-center">
                  <Building2 className="w-8 h-8 text-kage-text-dim" />
                </div>
                <h3 className="text-xl font-semibold text-kage-text mb-2">
                  No Organization Yet
                </h3>
                <p className="text-kage-text-muted mb-8 max-w-md mx-auto">
                  Create an organization to start setting up vesting schedules and positions for your team.
                </p>
                <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                  <Plus className="w-5 h-5" />
                  Create Organization
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Create Organization Modal */}
      {showCreateModal && (
        <CreateOrganizationModal onClose={handleModalClose} />
      )}

      {/* Manage Schedules Modal */}
      {showSchedulesModal && organization && (
        <ManageSchedulesModal
          onClose={handleModalClose}
          schedules={schedules}
          organization={organization}
        />
      )}

      {/* Manage Positions Modal */}
      {showPositionsModal && organization && (
        <ManagePositionsModal
          onClose={handleModalClose}
          organization={organization}
        />
      )}
    </Layout>
  )
}

// =============================================================================
// Create Organization Modal
// =============================================================================

interface CreateOrganizationModalProps {
  onClose: () => void
}

const CreateOrganizationModal: FC<CreateOrganizationModalProps> = ({
  onClose,
}) => {
  const [name, setName] = useState('')
  const [tokenMint, setTokenMint] = useState(DEVNET_TOKENS[0].mint)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { createOrganization } = useOrganization()

  const handleCreate = async () => {
    setLoading(true)
    setError(null)

    try {
      const mintPubkey = new PublicKey(tokenMint)
      const signature = await createOrganization({
        name,
        tokenMint: mintPubkey,
      })

      console.log('Organization created! Signature:', signature)
      onClose()
    } catch (err) {
      console.error('Failed to create organization:', err)
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed top-0 left-0 w-screen h-screen z-[100] flex items-center justify-center">
      <div className="absolute top-0 left-0 w-full h-full bg-black/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-kage-text">Create Organization</h2>
            <p className="text-sm text-kage-text-muted">Set up a new organization for vesting management</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
            <Input
              label="Organization Name"
              placeholder="Acme Corp"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TokenSelect
              label="Payment Token"
              value={tokenMint}
              onChange={setTokenMint}
              tokens={DEVNET_TOKENS}
            />
            <div className="flex gap-3 pt-4">
              <Button variant="ghost" onClick={onClose} className="flex-1" disabled={loading}>
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
      </div>
    </div>
  )
}

// =============================================================================
// Manage Schedules Modal
// =============================================================================

interface ManageSchedulesModalProps {
  onClose: () => void
  schedules: Array<{ publicKey: PublicKey; account: { cliffDuration: BN; totalDuration: BN; vestingInterval: BN; isActive: boolean } }>
  organization: PublicKey
}

const ManageSchedulesModal: FC<ManageSchedulesModalProps> = ({
  onClose,
  schedules,
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [cliffMonths, setCliffMonths] = useState('12')
  const [totalMonths, setTotalMonths] = useState('48')
  const [intervalDays, setIntervalDays] = useState('30')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { createSchedule } = useOrganization()

  const handleCreateSchedule = async () => {
    setLoading(true)
    setError(null)

    try {
      const cliffDuration = new BN(parseInt(cliffMonths) * 30 * 24 * 60 * 60) // months to seconds
      const totalDuration = new BN(parseInt(totalMonths) * 30 * 24 * 60 * 60)
      const vestingInterval = new BN(parseInt(intervalDays) * 24 * 60 * 60) // days to seconds

      await createSchedule({ cliffDuration, totalDuration, vestingInterval })
      setShowCreateForm(false)
      setCliffMonths('12')
      setTotalMonths('48')
      setIntervalDays('30')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed top-0 left-0 w-screen h-screen z-[100] flex items-center justify-center">
      <div className="absolute top-0 left-0 w-full h-full bg-black/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-kage-text">Vesting Schedules</h2>
                <p className="text-sm text-kage-text-muted">Manage your vesting schedules</p>
              </div>
              {!showCreateForm && (
                <Button variant="primary" size="sm" onClick={() => setShowCreateForm(true)}>
                  <Plus className="w-4 h-4" />
                  New
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Create Form */}
            {showCreateForm && (
              <div className="p-4 rounded-xl bg-kage-subtle space-y-4">
                <h3 className="font-medium text-kage-text">Create New Schedule</h3>
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    label="Cliff (months)"
                    type="number"
                    value={cliffMonths}
                    onChange={(e) => setCliffMonths(e.target.value)}
                  />
                  <Input
                    label="Total (months)"
                    type="number"
                    value={totalMonths}
                    onChange={(e) => setTotalMonths(e.target.value)}
                  />
                  <Input
                    label="Interval (days)"
                    type="number"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleCreateSchedule} loading={loading}>
                    Create Schedule
                  </Button>
                </div>
              </div>
            )}

            {/* Existing Schedules */}
            {schedules.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-kage-text-dim">No schedules yet</p>
                <p className="text-sm text-kage-text-dim mt-1">Create a schedule to start adding positions</p>
              </div>
            ) : (
              <div className="space-y-3">
                {schedules.map((schedule, index) => (
                  <div key={schedule.publicKey.toBase58()} className="p-4 rounded-xl bg-kage-elevated border border-kage-border-subtle">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-kage-text">Schedule #{index}</p>
                        <p className="text-xs text-kage-text-dim font-mono mt-1">
                          {formatAddress(schedule.publicKey.toBase58(), 8)}
                        </p>
                      </div>
                      <Badge variant={schedule.account.isActive ? 'success' : 'default'}>
                        {schedule.account.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                      <div>
                        <p className="text-kage-text-muted text-xs">Cliff</p>
                        <p className="text-kage-text">{formatDuration(schedule.account.cliffDuration.toNumber())}</p>
                      </div>
                      <div>
                        <p className="text-kage-text-muted text-xs">Total</p>
                        <p className="text-kage-text">{formatDuration(schedule.account.totalDuration.toNumber())}</p>
                      </div>
                      <div>
                        <p className="text-kage-text-muted text-xs">Interval</p>
                        <p className="text-kage-text">{formatDuration(schedule.account.vestingInterval.toNumber())}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-4">
              <Button variant="ghost" onClick={onClose} className="w-full">
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// =============================================================================
// Manage Positions Modal
// =============================================================================

interface ManagePositionsModalProps {
  onClose: () => void
  organization: PublicKey
}

const ManagePositionsModal: FC<ManagePositionsModalProps> = ({
  onClose,
}) => {
  const [selectedEmployee, setSelectedEmployee] = useState<{
    slug: string
    label: string | null
    metaAddress: { metaSpendPub: string; metaViewPub: string }
  } | null>(null)

  return (
    <div className="fixed top-0 left-0 w-screen h-screen z-[100] flex items-center justify-center">
      <div className="absolute top-0 left-0 w-full h-full bg-black/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-kage-text">Create Position</h2>
            <p className="text-sm text-kage-text-muted">Add a new vesting position for an employee</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Employee Lookup */}
            <EmployeeLookup onSelect={setSelectedEmployee} />

            {/* Selected Employee */}
            {selectedEmployee && (
              <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                <p className="text-sm text-green-400">
                  Selected: <strong>{selectedEmployee.label || selectedEmployee.slug}</strong> (kage.ink/{selectedEmployee.slug})
                </p>
              </div>
            )}

            {/* Position Creation Form - Coming Soon */}
            {selectedEmployee && (
              <div className="p-4 rounded-xl bg-kage-subtle">
                <p className="text-sm text-kage-text-muted text-center">
                  Position creation form coming soon...
                </p>
                <p className="text-xs text-kage-text-dim text-center mt-2">
                  This will allow you to select a schedule, set the amount, and create the position on-chain.
                </p>
              </div>
            )}

            <div className="pt-4">
              <Button variant="ghost" onClick={onClose} className="w-full">
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
