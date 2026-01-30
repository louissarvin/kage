import type { FC } from 'react'
import { useState, useRef, useLayoutEffect } from 'react'
import { PublicKey } from '@solana/web3.js'
import gsap from 'gsap'
import {
  Building2,
  Plus,
  Loader2,
  AlertCircle,
  Vault,
  CheckCircle2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, Button, Badge, Input, TokenSelect, DEVNET_TOKENS } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress, formatDuration, formatAmount } from '@/lib/constants'
import { useOrganization } from '@/hooks'
import { EmployeeLookup } from '@/components/EmployeeLookup'
import { api } from '@/lib/api'
import { createPositionWithPreparedData, BN } from '@/lib/sdk'
import type { VestingSchedule } from '@/lib/sdk'
import { useProgram } from '@/hooks'

// Schedule type from on-chain data
interface OnChainSchedule {
  publicKey: PublicKey
  account: VestingSchedule
}

export const Organizations: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSchedulesModal, setShowSchedulesModal] = useState(false)
  const [showPositionsModal, setShowPositionsModal] = useState(false)
  const [showVaultModal, setShowVaultModal] = useState(false)

  // Fetch user's organization only (admin view)
  const { organization, organizationData, schedules: onChainSchedules, stats, loading, error, refresh } = useOrganization()

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
    setShowVaultModal(false)
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
          {/* Only show Create button if user doesn't have an org yet */}
          {!organizationData && (
            <Button variant="primary" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-5 h-5" />
              Create Organization
            </Button>
          )}
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
                  <Badge variant={organizationData.isActive ? 'success' : 'default'} className="text-md">
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
                      <span className="text-xs">Vault Balance</span>
                    </div>
                    {stats && stats.vaultBalance !== null ? (
                      <p className="text-2xl font-semibold text-kage-text">
                        {formatAmount(stats.vaultBalance.toNumber(), 6)}
                      </p>
                    ) : (
                      <p className="text-sm text-kage-text-dim">Not initialized</p>
                    )}
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
                  {stats?.vaultBalance !== null ? (
                    <Button variant="primary" className="flex-1" onClick={() => setShowVaultModal(true)}>
                      Deposit
                    </Button>
                  ) : (
                    <Button variant="primary" className="flex-1" onClick={() => setShowVaultModal(true)}>
                      Init Vault
                    </Button>
                  )}
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
          organization={organization}
          onChainSchedules={onChainSchedules}
        />
      )}

      {/* Manage Positions Modal */}
      {showPositionsModal && organization && (
        <ManagePositionsModal
          onClose={handleModalClose}
          organization={organization}
          onChainSchedules={onChainSchedules}
        />
      )}

      {/* Vault Management Modal */}
      {showVaultModal && organization && (
        <VaultManagementModal
          onClose={handleModalClose}
          organization={organization}
          vaultBalance={stats?.vaultBalance ?? null}
        />
      )}
    </Layout>
  )
}

// =============================================================================
// Create Organization Modal (Combined: Create + Init Vault + Deposit)
// =============================================================================

interface CreateOrganizationModalProps {
  onClose: () => void
}

const CreateOrganizationModal: FC<CreateOrganizationModalProps> = ({
  onClose,
}) => {
  const [name, setName] = useState('')
  const [tokenMint, setTokenMint] = useState(DEVNET_TOKENS[0].mint)
  const [initialDeposit, setInitialDeposit] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'form' | 'creating' | 'depositing' | 'done'>('form')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const { createOrganizationWithVault } = useOrganization()

  const handleCreate = async () => {
    setLoading(true)
    setError(null)
    setStep('creating')

    try {
      const mintPubkey = new PublicKey(tokenMint)

      // Convert deposit to base units (6 decimals)
      const depositAmount = initialDeposit && parseFloat(initialDeposit) > 0
        ? new BN(Math.floor(parseFloat(initialDeposit) * 1e6))
        : undefined

      if (depositAmount) {
        setStep('depositing')
      }

      const result = await createOrganizationWithVault({
        name,
        tokenMint: mintPubkey,
        initialDeposit: depositAmount,
      })

      console.log('Organization created with vault! Signature:', result.signature)
      if (result.depositSignature) {
        console.log('Deposit signature:', result.depositSignature)
      }

      setStep('done')
      setSuccess(
        depositAmount
          ? `Organization created and funded with ${initialDeposit} tokens!`
          : 'Organization created with vault ready!'
      )

      // Auto-close after success
      setTimeout(() => onClose(), 1500)
    } catch (err) {
      console.error('Failed to create organization:', err)
      setError(err instanceof Error ? err.message : 'Failed to create organization')
      setStep('form')
    } finally {
      setLoading(false)
    }
  }

  const selectedToken = DEVNET_TOKENS.find(t => t.mint === tokenMint)

  return (
    <div className="fixed top-0 left-0 w-screen h-screen z-[100] flex items-center justify-center">
      <div className="absolute top-0 left-0 w-full h-full bg-black/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-lg font-semibold text-kage-text">Create Organization</h2>
                <p className="text-sm text-kage-text-muted">Set up org + vault in one step</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {success && (
              <div className="p-3 rounded-xl bg-green-500/10">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <p className="text-sm text-green-400">{success}</p>
                </div>
              </div>
            )}

            {/* Progress indicator during creation */}
            {loading && (
              <div className="p-4 rounded-xl bg-kage-subtle">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-kage-accent animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-kage-text">
                      {step === 'creating' && 'Creating organization & vault...'}
                      {step === 'depositing' && 'Depositing tokens...'}
                    </p>
                    <p className="text-xs text-kage-text-muted">
                      {step === 'creating' && 'Sign the transaction in your wallet'}
                      {step === 'depositing' && 'Sign the deposit transaction'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!loading && step === 'form' && (
              <>
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

                <Input
                  label={`Initial Deposit (${selectedToken?.symbol || 'tokens'})`}
                  type="number"
                  placeholder="0"
                  value={initialDeposit}
                  onChange={(e) => setInitialDeposit(e.target.value)}
                  hint="Optional - fund the vault now or deposit later"
                />

                {/* Summary */}
                <div className="p-4 rounded-xl bg-kage-subtle space-y-2">
                  <p className="text-xs text-kage-text-muted font-medium uppercase tracking-wide">What happens:</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm text-kage-text">
                      <div className="w-5 h-5 rounded-full bg-kage-accent/20 flex items-center justify-center text-xs text-kage-accent">1</div>
                      <span>Create organization on-chain</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-kage-text">
                      <div className="w-5 h-5 rounded-full bg-kage-accent/20 flex items-center justify-center text-xs text-kage-accent">2</div>
                      <span>Initialize token vault</span>
                    </div>
                    {initialDeposit && parseFloat(initialDeposit) > 0 && (
                      <div className="flex items-center gap-2 text-sm text-kage-text">
                        <div className="w-5 h-5 rounded-full bg-kage-accent/20 flex items-center justify-center text-xs text-kage-accent">3</div>
                        <span>Deposit {initialDeposit} {selectedToken?.symbol}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-kage-text-dim mt-2">
                    {initialDeposit && parseFloat(initialDeposit) > 0
                      ? '2 transactions to sign'
                      : '1 transaction to sign'}
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
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
                    Create Organization
                  </Button>
                </div>
              </>
            )}
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
  organization: PublicKey
  onChainSchedules: OnChainSchedule[]
}

const ManageSchedulesModal: FC<ManageSchedulesModalProps> = ({
  onClose,
  organization: _organization,
  onChainSchedules,
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
      const cliffDuration = parseInt(cliffMonths) * 30 * 24 * 60 * 60 // months to seconds
      const totalDuration = parseInt(totalMonths) * 30 * 24 * 60 * 60
      const vestingInterval = parseInt(intervalDays) * 24 * 60 * 60 // days to seconds

      // Create on-chain schedule
      await createSchedule({
        cliffDuration: { toNumber: () => cliffDuration } as BN,
        totalDuration: { toNumber: () => totalDuration } as BN,
        vestingInterval: { toNumber: () => vestingInterval } as BN,
      })

      setShowCreateForm(false)
      setCliffMonths('12')
      setTotalMonths('48')
      setIntervalDays('30')
      onClose() // Close to refresh
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

            {/* Existing Schedules from on-chain */}
            {onChainSchedules.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-kage-text-dim">No schedules yet</p>
                <p className="text-sm text-kage-text-dim mt-1">Create a schedule to start adding positions</p>
              </div>
            ) : (
              <div className="space-y-3">
                {onChainSchedules.map((schedule, index) => (
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
  onChainSchedules: OnChainSchedule[]
}

const ManagePositionsModal: FC<ManagePositionsModalProps> = ({
  onClose,
  organization,
  onChainSchedules,
}) => {
  const program = useProgram()
  const [selectedEmployee, setSelectedEmployee] = useState<{
    slug: string
    label: string | null
    metaAddress: { metaSpendPub: string; metaViewPub: string }
  } | null>(null)
  const [selectedScheduleIndex, setSelectedScheduleIndex] = useState<number>(0)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleCreatePosition = async () => {
    if (!selectedEmployee || !amount || onChainSchedules.length === 0 || !program) return

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // Step 1: Call backend to prepare encrypted data (Arcium MPC encryption in Node.js)
      const amountInBaseUnits = Math.floor(parseFloat(amount) * 1e6).toString() // 6 decimals

      console.log('Preparing position via backend relay...')
      const preparedData = await api.preparePositionOnChain({
        organizationPubkey: organization.toBase58(),
        scheduleIndex: selectedScheduleIndex,
        employeeSlug: selectedEmployee.slug,
        amount: amountInBaseUnits,
      })

      console.log('Prepared data received:', preparedData)

      // Step 2: Build and submit transaction using prepared encrypted data
      const result = await createPositionWithPreparedData(
        program,
        organization,
        preparedData
      )

      setSuccess(`Position created on-chain! Tx: ${result.signature.slice(0, 8)}... (Position ID: ${result.positionId})`)
      setSelectedEmployee(null)
      setAmount('')
    } catch (err) {
      console.error('Failed to create position:', err)
      setError(err instanceof Error ? err.message : 'Failed to create position')
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
            <h2 className="text-lg font-semibold text-kage-text">Create Position</h2>
            <p className="text-sm text-kage-text-muted">Add a new vesting position for an employee</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {success && (
              <div className="p-3 rounded-xl bg-green-500/10">
                <p className="text-sm text-green-400">{success}</p>
              </div>
            )}

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

            {/* Position Creation Form */}
            {selectedEmployee && (
              <div className="space-y-4">
                {/* Schedule Selection */}
                {onChainSchedules.length === 0 ? (
                  <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                    <p className="text-sm text-yellow-400">
                      No schedules available. Create a schedule first in "Manage Schedules".
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-kage-text-muted">
                      Vesting Schedule
                    </label>
                    <select
                      value={selectedScheduleIndex}
                      onChange={(e) => setSelectedScheduleIndex(parseInt(e.target.value))}
                      className="w-full px-3 py-2 bg-kage-elevated border border-kage-border rounded-2xl text-kage-text focus:outline-none focus:border-kage-accent-dim"
                    >
                      {onChainSchedules.map((schedule, index) => (
                        <option key={schedule.publicKey.toBase58()} value={index}>
                          Schedule #{index} - {formatDuration(schedule.account.cliffDuration.toNumber())} cliff, {formatDuration(schedule.account.totalDuration.toNumber())} total
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Amount Input */}
                <Input
                  label="Amount (tokens)"
                  type="number"
                  placeholder="10000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  hint="Enter the total vesting amount"
                />

                {/* Create Button */}
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={handleCreatePosition}
                  loading={loading}
                  disabled={!selectedEmployee || !amount || onChainSchedules.length === 0 || loading}
                >
                  Create Position
                </Button>
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
// Vault Management Modal
// =============================================================================

interface VaultManagementModalProps {
  onClose: () => void
  organization: PublicKey
  vaultBalance: BN | null
}

const VaultManagementModal: FC<VaultManagementModalProps> = ({
  onClose,
  organization: _organization,
  vaultBalance,
}) => {
  const [depositAmount, setDepositAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const { initializeVault, depositToVault } = useOrganization()

  const isVaultInitialized = vaultBalance !== null

  const handleInitializeVault = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const signature = await initializeVault()
      setSuccess(`Vault initialized! Tx: ${signature.slice(0, 8)}...`)
      // Close after success to trigger refresh
      setTimeout(() => onClose(), 1500)
    } catch (err) {
      console.error('Failed to initialize vault:', err)
      setError(err instanceof Error ? err.message : 'Failed to initialize vault')
    } finally {
      setLoading(false)
    }
  }

  const handleDeposit = async () => {
    if (!depositAmount) return

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // Convert to base units (6 decimals for most tokens)
      const amountInBaseUnits = Math.floor(parseFloat(depositAmount) * 1e6)
      const signature = await depositToVault(new BN(amountInBaseUnits))
      setSuccess(`Deposited ${depositAmount} tokens! Tx: ${signature.slice(0, 8)}...`)
      setDepositAmount('')
      // Close after success to trigger refresh
      setTimeout(() => onClose(), 1500)
    } catch (err) {
      console.error('Failed to deposit:', err)
      setError(err instanceof Error ? err.message : 'Failed to deposit tokens')
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
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-lg font-semibold text-kage-text">
                  {isVaultInitialized ? 'Deposit to Vault' : 'Initialize Vault'}
                </h2>
                <p className="text-sm text-kage-text-muted">
                  {isVaultInitialized
                    ? 'Add tokens to fund vesting positions'
                    : 'Create token account for your organization'}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {success && (
              <div className="p-3 rounded-xl bg-green-500/10">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <p className="text-sm text-green-400">{success}</p>
                </div>
              </div>
            )}

            {!isVaultInitialized ? (
              // Initialize Vault UI
              <>
                <div className="p-4 rounded-xl bg-kage-subtle">
                  <p className="text-sm text-kage-text-muted">
                    Initializing the vault will create a token account associated with your organization.
                    This account will hold the tokens used to fund employee vesting positions.
                  </p>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button variant="ghost" onClick={onClose} className="flex-1" disabled={loading}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleInitializeVault}
                    loading={loading}
                    className="flex-1"
                  >
                    <Vault className="w-4 h-4" />
                    Initialize
                  </Button>
                </div>
              </>
            ) : (
              // Deposit UI
              <>
                <div className="p-4 rounded-xl bg-kage-subtle">
                  <p className="text-xs text-kage-text-muted mb-1">Current Balance</p>
                  <p className="text-xl font-semibold text-kage-text">
                    {formatAmount(vaultBalance.toNumber(), 6)} <span className="text-sm text-kage-text-muted">tokens</span>
                  </p>
                </div>

                <Input
                  label="Deposit Amount"
                  type="number"
                  placeholder="1000"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  hint="Enter amount to deposit (from your wallet's token account)"
                />

                <div className="flex gap-3 pt-2">
                  <Button variant="ghost" onClick={onClose} className="flex-1" disabled={loading}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleDeposit}
                    loading={loading}
                    disabled={!depositAmount || parseFloat(depositAmount) <= 0}
                    className="flex-1"
                  >
                    Deposit
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
