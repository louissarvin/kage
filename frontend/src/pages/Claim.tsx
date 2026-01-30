import type { FC } from 'react'
import { useState, useRef, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'
import gsap from 'gsap'
import {
  Shield,
  Unlock,
  CheckCircle,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, Button, Input, Badge } from '@/components/ui'
import { Layout } from '@/components/layout'

type ClaimStep = 'select' | 'authorize' | 'process' | 'withdraw' | 'complete'

export const Claim: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<ClaimStep>('select')
  const [claimAmount, setClaimAmount] = useState('')

  const steps = [
    { id: 'select', label: 'Select Position' },
    { id: 'authorize', label: 'Authorize' },
    { id: 'process', label: 'Process' },
    { id: 'withdraw', label: 'Withdraw' },
  ]

  const currentStepIndex = steps.findIndex((s) => s.id === step)

  // GSAP page animation
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
      )
      gsap.fromTo(
        '.claim-section',
        { opacity: 0, y: 15 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, ease: 'power2.out', delay: 0.1 }
      )
    }, containerRef)
    return () => ctx.revert()
  }, [])

  return (
    <Layout>
      <div ref={containerRef} className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="claim-section text-center">
          <h1 className="text-2xl font-semibold text-kage-text">
            Claim Vested Tokens
          </h1>
          <p className="mt-2 text-kage-text-muted">
            Securely claim your vested tokens using zero-knowledge proofs
          </p>
        </div>

        {/* Progress */}
        <div className="claim-section flex items-center justify-between">
          {steps.map((s, index) => (
            <div key={s.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                    transition-colors duration-300
                    ${
                      index < currentStepIndex
                        ? 'bg-kage-accent text-kage-void'
                        : index === currentStepIndex
                          ? 'bg-kage-accent-glow text-kage-accent border border-kage-accent'
                          : 'bg-kage-subtle text-kage-text-dim'
                    }
                  `}
                >
                  {index < currentStepIndex ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={`
                    mt-2 text-xs font-medium
                    ${
                      index <= currentStepIndex
                        ? 'text-kage-text-muted'
                        : 'text-kage-text-dim'
                    }
                  `}
                >
                  {s.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`
                    w-16 sm:w-24 h-px mx-2 -mt-6
                    ${
                      index < currentStepIndex
                        ? 'bg-kage-accent'
                        : 'bg-kage-border'
                    }
                  `}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {step === 'select' && (
            <SelectPositionStep
              onSelect={() => {
                setStep('authorize')
              }}
            />
          )}
          {step === 'authorize' && (
            <AuthorizeStep
              amount={claimAmount}
              setAmount={setClaimAmount}
              onAuthorize={() => setStep('process')}
              onBack={() => setStep('select')}
            />
          )}
          {step === 'process' && (
            <ProcessStep
              onProcess={() => setStep('withdraw')}
              onBack={() => setStep('authorize')}
            />
          )}
          {step === 'withdraw' && (
            <WithdrawStep
              onWithdraw={() => setStep('complete')}
              onBack={() => setStep('process')}
            />
          )}
          {step === 'complete' && (
            <CompleteStep onReset={() => setStep('select')} />
          )}
        </motion.div>
      </div>
    </Layout>
  )
}

interface StepProps {
  onBack?: () => void
}

const SelectPositionStep: FC<{ onSelect: () => void }> = ({
  onSelect,
}) => {
  const positions: { publicKey: string; positionId: number }[] = [] // Replace with actual data

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-medium text-kage-text">
          Select Vesting Position
        </h2>
        <p className="text-sm text-kage-text-muted">
          Choose a position to claim tokens from
        </p>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-kage-text-muted">No claimable positions</p>
            <p className="text-sm text-kage-text-dim mt-1">
              You don't have any positions with claimable tokens
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map((pos) => (
              <button
                key={pos.publicKey}
                onClick={() => onSelect()}
                className="w-full p-4 rounded-lg bg-kage-elevated border border-kage-border-subtle hover:border-kage-accent-dim text-left transition-colors"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium text-kage-text">
                      Position #{pos.positionId}
                    </p>
                    <p className="text-sm text-kage-text-muted mt-1">
                      Claimable: --- tokens
                    </p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-kage-text-dim" />
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const AuthorizeStep: FC<
  StepProps & {
    amount: string
    setAmount: (v: string) => void
    onAuthorize: () => void
  }
> = ({ amount, setAmount, onAuthorize, onBack }) => {
  const [loading, setLoading] = useState(false)

  const handleAuthorize = async () => {
    setLoading(true)
    // TODO: Implement Ed25519 signature for authorization
    await new Promise((r) => setTimeout(r, 1500))
    setLoading(false)
    onAuthorize()
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-medium text-kage-text">
          Authorize Claim
        </h2>
        <p className="text-sm text-kage-text-muted">
          Sign with your stealth key to authorize the claim
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <Input
          label="Claim Amount"
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint="Enter the amount of tokens to claim"
        />

        <div className="p-4 rounded-lg bg-kage-subtle border border-kage-border-subtle">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-kage-accent mt-0.5" />
            <div>
              <p className="text-sm font-medium text-kage-text">
                Privacy Protected
              </p>
              <p className="text-xs text-kage-text-muted mt-1">
                Your claim will be processed using zero-knowledge proofs.
                Neither the amount nor your identity will be revealed on-chain.
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="ghost" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleAuthorize}
            loading={loading}
            disabled={!amount || Number(amount) <= 0}
            className="flex-1"
          >
            Sign & Authorize
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

const ProcessStep: FC<StepProps & { onProcess: () => void }> = ({
  onProcess,
  onBack,
}) => {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'proving' | 'verifying'>('idle')

  const handleProcess = async () => {
    setLoading(true)
    setStatus('proving')
    // TODO: Generate ZK proof
    await new Promise((r) => setTimeout(r, 2000))
    setStatus('verifying')
    // TODO: Submit to MPC
    await new Promise((r) => setTimeout(r, 1500))
    setLoading(false)
    onProcess()
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-medium text-kage-text">
          Process Claim
        </h2>
        <p className="text-sm text-kage-text-muted">
          Generate proof and submit to secure computation
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="py-8 text-center">
            <Loader2 className="w-8 h-8 text-kage-accent mx-auto animate-spin" />
            <p className="text-kage-text mt-4">
              {status === 'proving'
                ? 'Generating zero-knowledge proof...'
                : 'Submitting to MPC network...'}
            </p>
            <p className="text-sm text-kage-text-dim mt-1">
              This may take a moment
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-kage-elevated border border-kage-border-subtle">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-kage-accent-glow flex items-center justify-center">
                    <span className="text-sm font-medium text-kage-accent">1</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-kage-text">
                      Generate ZK Proof
                    </p>
                    <p className="text-xs text-kage-text-muted">
                      Prove eligibility without revealing amounts
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-kage-elevated border border-kage-border-subtle">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-kage-subtle flex items-center justify-center">
                    <span className="text-sm font-medium text-kage-text-dim">2</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-kage-text">
                      MPC Verification
                    </p>
                    <p className="text-xs text-kage-text-muted">
                      Arcium network validates the claim securely
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="ghost" onClick={onBack} className="flex-1">
                Back
              </Button>
              <Button variant="primary" onClick={handleProcess} className="flex-1">
                Process Claim
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

const WithdrawStep: FC<StepProps & { onWithdraw: () => void }> = ({
  onWithdraw,
  onBack,
}) => {
  const [loading, setLoading] = useState(false)

  const handleWithdraw = async () => {
    setLoading(true)
    // TODO: Execute withdrawal
    await new Promise((r) => setTimeout(r, 1500))
    setLoading(false)
    onWithdraw()
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-medium text-kage-text">
          Withdraw Tokens
        </h2>
        <p className="text-sm text-kage-text-muted">
          Transfer claimed tokens to your wallet
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 rounded-lg bg-kage-accent-glow border border-kage-accent/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-kage-accent" />
              <span className="text-sm font-medium text-kage-text">
                Claim Verified
              </span>
            </div>
            <Badge variant="success">Ready</Badge>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-kage-text-muted">Amount</span>
            <span className="text-kage-text">--- tokens</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-kage-text-muted">Destination</span>
            <span className="text-kage-text font-mono">Your wallet</span>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="ghost" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleWithdraw}
            loading={loading}
            className="flex-1"
          >
            <Unlock className="w-4 h-4" />
            Withdraw
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

const CompleteStep: FC<{ onReset: () => void }> = ({ onReset }) => {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', duration: 0.5 }}
          className="w-16 h-16 rounded-full bg-kage-accent-glow mx-auto mb-6 flex items-center justify-center"
        >
          <CheckCircle className="w-8 h-8 text-kage-accent" />
        </motion.div>
        <h2 className="text-xl font-semibold text-kage-text">
          Claim Complete
        </h2>
        <p className="text-kage-text-muted mt-2">
          Your tokens have been successfully withdrawn to your wallet
        </p>
        <Button variant="secondary" onClick={onReset} className="mt-8">
          Claim More Tokens
        </Button>
      </CardContent>
    </Card>
  )
}
