import type { FC } from 'react'
import { useState, useRef, useLayoutEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import gsap from 'gsap'
import {
  PublicKey,
  Ed25519Program,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import {
  Shield,
  Unlock,
  CheckCircle,
  ArrowRight,
  Loader2,
  AlertCircle,
  Zap,
  Key,
} from 'lucide-react'
import { Card, CardContent, CardHeader, Button, Badge } from '@/components/ui'
import { Layout } from '@/components/layout'
import { formatAddress } from '@/lib/constants'
import { useAuth } from '@/contexts/AuthContext'
import { useEmployeePositions, useVaultKeys, type PositionWithStats } from '@/hooks'
import { useProgram } from '@/hooks/useProgram'
import { api, ApiError } from '@/lib/api'
import { cacheStealthKeys } from '@/lib/stealth-key-cache'
import {
  deriveStealthKeypair,
  decryptEphemeralPrivKey,
  createNullifier,
} from '@/lib/stealth-address'
import {
  createLightRpc,
  buildLightRemainingAccountsFromTrees,
  serializeValidityProof,
  serializeCompressedAccountMeta,
  parseCompressedPositionData,
  BN,
  findClaimAuthorizationPda,
  findNullifierPda,
  fetchOrganization,
  PROGRAM_ID,
} from '@/lib/sdk'
import { defaultTestStateTreeAccounts, bn } from '@lightprotocol/stateless.js'

// Light Protocol RPC endpoint
const LIGHT_RPC_ENDPOINT = import.meta.env.VITE_HELIUS_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=YOUR_KEY'

type ClaimStep = 'select' | 'authorize' | 'process' | 'withdraw' | 'complete'

interface SelectedPosition {
  publicKey: PublicKey
  positionId: number
  organization: PublicKey
  vestingProgress: number
  isCompressed: boolean
}

export const Claim: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<ClaimStep>('select')
  const [selectedPosition, setSelectedPosition] = useState<SelectedPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txSignature, setTxSignature] = useState<string | null>(null)
  const [claimAuthPda, setClaimAuthPda] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  // Get user's stealth keys
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const metaSpendPub = user?.wallets[0]?.metaSpendPub ?? null
  const metaViewPub = user?.wallets[0]?.metaViewPub ?? null
  const hasStealthKeys = !!metaSpendPub && !!metaViewPub

  // Fetch positions
  const { positions, loading: positionsLoading } = useEmployeePositions(
    metaSpendPub,
    metaViewPub
  )

  // Filter to claimable positions (not in cliff, active)
  const claimablePositions = useMemo(() => {
    const currentTime = Math.floor(Date.now() / 1000)
    return positions.filter((pos) => {
      const isInCliff = currentTime < pos.stats.cliffEndTime
      return pos.account.isActive && !isInCliff && pos.stats.vestingProgress > 0
    })
  }, [positions])

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

  const handleSelectPosition = (pos: PositionWithStats) => {
    setSelectedPosition({
      publicKey: pos.publicKey,
      positionId: pos.account.positionId.toNumber(),
      organization: pos.account.organization,
      vestingProgress: pos.stats.vestingProgress,
      isCompressed: pos.isCompressed ?? false,
    })
    setError(null)
    setStep('authorize')
  }

  const handleReset = () => {
    setStep('select')
    setSelectedPosition(null)
    setError(null)
    setTxSignature(null)
    setClaimAuthPda(null)
    setJobId(null)
  }

  // Loading state
  if (authLoading || positionsLoading) {
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
        <div ref={containerRef} className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-16 text-center">
              <h3 className="text-xl font-semibold text-kage-text mb-2">
                Connect Wallet
              </h3>
              <p className="text-kage-text-muted max-w-md mx-auto">
                Connect your wallet and sign in to claim your vested tokens.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    )
  }

  // No stealth keys
  if (!hasStealthKeys) {
    return (
      <Layout>
        <div ref={containerRef} className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 mx-auto mb-6 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-yellow-400" />
              </div>
              <h3 className="text-xl font-semibold text-kage-text mb-2">
                Complete Setup
              </h3>
              <p className="text-kage-text-muted max-w-md mx-auto mb-6">
                You need to register your stealth keys before you can claim tokens.
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

        {/* Error display */}
        {error && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-400">{error}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setError(null)}
                  className="mt-2 text-red-400"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step content */}
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {step === 'select' && (
            <SelectPositionStep
              positions={claimablePositions}
              onSelect={handleSelectPosition}
            />
          )}
          {step === 'authorize' && selectedPosition && (
            <AuthorizeStep
              position={selectedPosition}
              metaSpendPub={metaSpendPub!}
              metaViewPub={metaViewPub!}
              onAuthorize={(sig, authPda) => {
                setTxSignature(sig)
                setClaimAuthPda(authPda)
                setStep('process')
              }}
              onError={setError}
              onBack={() => setStep('select')}
            />
          )}
          {step === 'process' && selectedPosition && (
            <ProcessStep
              position={selectedPosition}
              txSignature={txSignature}
              claimAuthPda={claimAuthPda}
              onProcess={(id) => {
                setJobId(id)
                setStep('withdraw')
              }}
              onError={setError}
              onBack={() => setStep('authorize')}
            />
          )}
          {step === 'withdraw' && selectedPosition && (
            <WithdrawStep
              position={selectedPosition}
              jobId={jobId}
              onWithdraw={() => setStep('complete')}
              onError={setError}
              onBack={() => setStep('process')}
            />
          )}
          {step === 'complete' && (
            <CompleteStep
              txSignature={txSignature}
              onReset={handleReset}
            />
          )}
        </motion.div>
      </div>
    </Layout>
  )
}

// =============================================================================
// Step Components
// =============================================================================

interface SelectPositionStepProps {
  positions: PositionWithStats[]
  onSelect: (pos: PositionWithStats) => void
}

const SelectPositionStep: FC<SelectPositionStepProps> = ({ positions, onSelect }) => {
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
                key={pos.publicKey.toBase58()}
                onClick={() => onSelect(pos)}
                className="w-full p-4 rounded-lg bg-kage-elevated border border-kage-border-subtle hover:border-kage-accent-dim text-left transition-colors"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-kage-text">
                        Position #{pos.account.positionId.toNumber()}
                      </p>
                      {pos.isCompressed && (
                        <Badge variant="accent" className="text-xs">
                          <Zap className="w-3 h-3 mr-1" />
                          Compressed
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-kage-text-muted mt-1">
                      {pos.stats.vestingProgress}% vested
                    </p>
                    <p className="text-xs text-kage-text-dim mt-1 font-mono">
                      {formatAddress(pos.account.organization.toBase58(), 8)}
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

interface AuthorizeStepProps {
  position: SelectedPosition
  metaSpendPub: string
  metaViewPub: string
  onAuthorize: (txSignature: string, claimAuthPda: string) => void
  onError: (error: string) => void
  onBack: () => void
}

const AuthorizeStep: FC<AuthorizeStepProps> = ({
  position,
  metaSpendPub: _metaSpendPub,
  metaViewPub,
  onAuthorize,
  onError,
  onBack,
}) => {
  // Note: metaSpendPub is passed for reference but the actual keys are retrieved from vault
  void _metaSpendPub
  const program = useProgram()
  const {
    keys: vaultKeys,
    hasKeys: hasCachedKeys,
    isLoading: vaultLoading,
    error: vaultError,
    status: vaultStatus,
    retrieveKeys,
  } = useVaultKeys()

  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')

  const handleAuthorize = async () => {
    if (!program) {
      onError('Program not initialized')
      return
    }

    setLoading(true)
    setStatus('Preparing claim authorization...')

    try {
      if (position.isCompressed) {
        // ============================================
        // COMPRESSED POSITION AUTHORIZATION
        // ============================================

        // Step 1: Get stealth keys (from cache or vault)
        let stealthKeys = vaultKeys

        if (!stealthKeys) {
          setStatus('Retrieving stealth keys from vault...')

          // Automatically trigger vault read flow
          stealthKeys = await retrieveKeys()

          if (!stealthKeys) {
            throw new Error(
              vaultError ||
              'Failed to retrieve stealth keys from vault. Please ensure your vault is set up.'
            )
          }
        }

        // Step 2: Get ephemeral key and payload from backend
        setStatus('Fetching stealth payment data...')

        let ephemeralPubkey: string
        let encryptedPayload: string

        try {
          ephemeralPubkey = await api.getStealthPaymentEphemeralKey({
            organizationPubkey: position.organization.toBase58(),
            positionId: position.positionId,
          })
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            throw new Error(
              'Ephemeral key not found. This position may have been created before the stealth system was set up. ' +
              'Please contact the organization admin to recreate the position.'
            )
          }
          throw err
        }

        try {
          encryptedPayload = await api.getStealthPaymentPayload({
            organizationPubkey: position.organization.toBase58(),
            positionId: position.positionId,
          })
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            throw new Error(
              'Encrypted payload not found. This position was created before the privacy features were enabled. ' +
              'Please contact the organization admin to recreate the position with full privacy support.'
            )
          }
          throw err
        }

        // Step 3: Decrypt ephemeral private key
        setStatus('Decrypting ephemeral key...')
        const ephPriv32 = await decryptEphemeralPrivKey(
          encryptedPayload,
          stealthKeys.viewPrivKeyHex,
          ephemeralPubkey
        )

        // Step 4: Derive stealth signing keypair
        setStatus('Deriving stealth signer...')
        const stealthSigner = await deriveStealthKeypair(
          stealthKeys.spendPrivKeyHex,
          metaViewPub,
          ephPriv32
        )

        console.log('Stealth signer derived:', stealthSigner.publicKey.toBase58())

        // Step 5: Create nullifier
        const nullifier = createNullifier(stealthSigner.publicKey, position.positionId)

        // Step 6: Initialize Light RPC and fetch compressed position
        setStatus('Fetching compressed position...')
        const lightRpc = createLightRpc(LIGHT_RPC_ENDPOINT)

        const compressedAccount = await lightRpc.getCompressedAccount(
          bn(position.publicKey.toBytes())
        )
        if (!compressedAccount) {
          throw new Error('Compressed position not found on-chain')
        }

        // Step 7: Parse position data
        const positionData = parseCompressedPositionData(
          Buffer.from(compressedAccount.data!.data!)
        )

        // Step 8: Get organization data for token mint
        const orgData = await fetchOrganization(program, position.organization)
        if (!orgData) {
          throw new Error('Organization not found')
        }

        // Step 9: Create destination token account
        const tokenMint = orgData.tokenMint
        const destinationAta = await getAssociatedTokenAddress(
          tokenMint,
          program.provider.publicKey!
        )

        // Step 10: Build claim message and sign with stealth key
        setStatus('Signing authorization with stealth key...')
        const positionIdBytes = Buffer.alloc(8)
        positionIdBytes.writeBigUInt64LE(BigInt(position.positionId))
        const message = Buffer.concat([
          positionIdBytes,
          Buffer.from(nullifier),
          destinationAta.toBuffer(),
        ])

        const signature = await stealthSigner.signMessage(message)
        console.log('Claim message signed with stealth key')

        // Step 11: Create Ed25519 verify instruction
        const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
          publicKey: stealthSigner.publicKey.toBytes(),
          message: Uint8Array.from(message),
          signature: signature,
        })

        // Step 12: Get validity proof
        setStatus('Getting validity proof...')
        const proof = await lightRpc.getValidityProofV0(
          [
            {
              hash: compressedAccount.hash,
              tree: compressedAccount.treeInfo.tree,
              queue: compressedAccount.treeInfo.queue,
            },
          ],
          []
        )

        // Step 13: Build remaining accounts
        const trees = defaultTestStateTreeAccounts()
        const remainingAccounts = buildLightRemainingAccountsFromTrees(
          [trees.merkleTree, trees.nullifierQueue],
          PROGRAM_ID
        )

        // Step 14: Serialize proof and account meta
        const proofBytes = serializeValidityProof(proof)
        const accountMetaBytes = serializeCompressedAccountMeta(proof, position.publicKey)

        // Step 15: Derive PDAs
        const [claimAuthPda] = findClaimAuthorizationPda(
          position.organization,
          position.positionId,
          nullifier
        )
        const [nullifierRecordPda] = findNullifierPda(
          position.organization,
          nullifier
        )

        // Step 16: Build authorize claim instruction
        setStatus('Building authorization transaction...')
        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })

        const authorizeIx = await program.methods
          .authorizeClaimCompressed(
            Buffer.from(proofBytes),
            Buffer.from(accountMetaBytes),
            positionData.owner,
            positionData.organization,
            positionData.schedule,
            new BN(positionData.positionId),
            Array.from(positionData.beneficiaryCommitment) as number[],
            Array.from(positionData.encryptedTotalAmount) as number[],
            Array.from(positionData.encryptedClaimedAmount) as number[],
            new BN(positionData.nonce.toString()),
            new BN(positionData.startTimestamp),
            positionData.isActive,
            positionData.isFullyClaimed,
            Array.from(nullifier) as number[],
            destinationAta
          )
          .accountsPartial({
            claimAuthorization: claimAuthPda,
            nullifierRecord: nullifierRecordPda,
            organization: position.organization,
            feePayer: program.provider.publicKey!,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(remainingAccounts)
          .instruction()

        // Step 17: Build and send versioned transaction
        setStatus('Sending authorization transaction...')
        const connection = program.provider.connection
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const messageV0 = new TransactionMessage({
          payerKey: program.provider.publicKey!,
          recentBlockhash: blockhash,
          instructions: [computeIx, priorityFeeIx, ed25519Ix, authorizeIx],
        }).compileToV0Message()

        const versionedTx = new VersionedTransaction(messageV0)

        // Sign with wallet
        if (!program.provider.wallet) {
          throw new Error('Wallet not connected')
        }
        const signedTx = await program.provider.wallet.signTransaction(versionedTx)

        const txSig = await connection.sendTransaction(signedTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        })

        await connection.confirmTransaction({
          signature: txSig,
          blockhash,
          lastValidBlockHeight,
        }, 'confirmed')

        console.log('Claim authorized! Tx:', txSig)
        onAuthorize(txSig, claimAuthPda.toBase58())

      } else {
        // ============================================
        // REGULAR POSITION AUTHORIZATION
        // ============================================
        onError('Regular position claims not yet implemented. Use compressed positions.')
      }
    } catch (err) {
      console.error('Authorization error:', err)
      onError(err instanceof Error ? err.message : 'Authorization failed')
    } finally {
      setLoading(false)
      setStatus('')
    }
  }

  // Handler for manual stealth key input (for testing/development)
  const handleManualKeyInput = () => {
    const spendKey = prompt('Enter spend private key (hex):')
    const viewKey = prompt('Enter view private key (hex):')
    if (spendKey && viewKey && spendKey.length === 64 && viewKey.length === 64) {
      cacheStealthKeys(spendKey, viewKey)
      // Force re-check by refreshing the page state
      window.location.reload()
    } else if (spendKey || viewKey) {
      onError('Invalid keys. Keys must be 64-character hex strings.')
    }
  }

  // Get status message for vault retrieval
  const getVaultStatusMessage = () => {
    switch (vaultStatus) {
      case 'checking-vault':
        return 'Checking vault status...'
      case 'reading-vault':
        return 'Initiating vault read...'
      case 'waiting-event':
        return 'Waiting for MPC decryption (this may take a moment)...'
      case 'decrypting':
        return 'Decrypting keys...'
      default:
        return status
    }
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
        {/* Position Info */}
        <div className="p-4 rounded-lg bg-kage-elevated border border-kage-border-subtle">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-kage-text-muted">Position</p>
              <p className="font-medium text-kage-text">#{position.positionId}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-kage-text-muted">Vested</p>
              <p className="font-medium text-kage-accent">{position.vestingProgress}%</p>
            </div>
          </div>
        </div>

        {/* Stealth Keys Status */}
        <div className={`p-4 rounded-lg border ${
          hasCachedKeys
            ? 'bg-green-500/10 border-green-500/20'
            : vaultLoading
              ? 'bg-kage-accent/10 border-kage-accent/20'
              : 'bg-yellow-500/10 border-yellow-500/20'
        }`}>
          <div className="flex items-start gap-3">
            {vaultLoading ? (
              <Loader2 className="w-5 h-5 text-kage-accent animate-spin mt-0.5" />
            ) : (
              <Key className={`w-5 h-5 mt-0.5 ${hasCachedKeys ? 'text-green-400' : 'text-yellow-400'}`} />
            )}
            <div className="flex-1">
              <p className={`text-sm font-medium ${
                hasCachedKeys ? 'text-green-400' : vaultLoading ? 'text-kage-accent' : 'text-yellow-400'
              }`}>
                {hasCachedKeys
                  ? 'Stealth Keys Ready'
                  : vaultLoading
                    ? 'Retrieving Keys from Vault'
                    : 'Stealth Keys Required'}
              </p>
              <p className="text-xs text-kage-text-muted mt-1">
                {hasCachedKeys
                  ? 'Your stealth keys are cached and ready for signing.'
                  : vaultLoading
                    ? getVaultStatusMessage()
                    : 'Keys will be automatically retrieved from Arcium vault when you proceed.'}
              </p>
              {!hasCachedKeys && !vaultLoading && (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => retrieveKeys()}
                    className="text-xs"
                  >
                    Retrieve Keys Now
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleManualKeyInput}
                    className="text-xs text-kage-text-dim"
                  >
                    Manual Entry (Dev)
                  </Button>
                </div>
              )}
              {vaultError && (
                <p className="text-xs text-red-400 mt-2">{vaultError}</p>
              )}
            </div>
          </div>
        </div>

        {/* Privacy Info */}
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

        {/* Loading Status */}
        {loading && status && !vaultLoading && (
          <div className="p-4 rounded-lg bg-kage-accent/10 border border-kage-accent/20">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-kage-accent animate-spin" />
              <p className="text-sm text-kage-accent">{status}</p>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="ghost" onClick={onBack} disabled={loading || vaultLoading} className="flex-1">
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleAuthorize}
            loading={loading || vaultLoading}
            className="flex-1"
          >
            {loading || vaultLoading ? 'Processing...' : 'Sign & Authorize'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface ProcessStepProps {
  position: SelectedPosition
  txSignature: string | null
  claimAuthPda: string | null
  onProcess: (jobId: string) => void
  onError: (error: string) => void
  onBack: () => void
}

const ProcessStep: FC<ProcessStepProps> = ({
  position,
  txSignature,
  claimAuthPda,
  onProcess,
  onError,
  onBack,
}) => {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'queuing' | 'processing'>('idle')

  const handleProcess = async () => {
    if (!claimAuthPda) {
      onError('Claim authorization PDA not found. Please go back and authorize again.')
      return
    }

    setLoading(true)
    setStatus('queuing')

    try {
      // TODO: This simplified claim UI is deprecated.
      // Use the Positions page for full claim functionality.
      // The Positions page has access to stealth keys, nullifiers, and destination accounts.
      throw new Error(
        'Please use the Positions page to claim tokens. ' +
        'This simplified UI is being deprecated in favor of the full claim flow.'
      )

      // Legacy code (kept for reference):
      // const result = await api.queueProcessClaim({
      //   organizationPubkey: position.organization.toBase58(),
      //   positionId: position.positionId,
      //   claimAuthPda: claimAuthPda,
      //   isCompressed: position.isCompressed,
      //   nullifier: [], // Requires stealth key derivation
      //   destinationTokenAccount: '', // Requires wallet connection
      //   claimAmount: '0',
      //   beneficiaryCommitment: [],
      // })

      setStatus('processing')

      // In production, poll for completion
      // For now, simulate processing time
      await new Promise((r) => setTimeout(r, 2000))

      onProcess(result.jobId)
    } catch (err) {
      console.error('Process error:', err)
      onError(err instanceof Error ? err.message : 'Processing failed')
    } finally {
      setLoading(false)
      setStatus('idle')
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-medium text-kage-text">
          Process Claim
        </h2>
        <p className="text-sm text-kage-text-muted">
          Submit to Arcium MPC for secure computation
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="py-8 text-center">
            <Loader2 className="w-8 h-8 text-kage-accent mx-auto animate-spin" />
            <p className="text-kage-text mt-4">
              {status === 'queuing'
                ? 'Queuing MPC computation...'
                : 'Processing claim securely...'}
            </p>
            <p className="text-sm text-kage-text-dim mt-1">
              This may take a moment
            </p>
          </div>
        ) : (
          <>
            {txSignature && (
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span className="text-sm font-medium text-green-400">
                    Authorization confirmed
                  </span>
                </div>
                <p className="text-xs text-kage-text-dim mt-2 font-mono">
                  Tx: {txSignature.slice(0, 20)}...
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-kage-elevated border border-kage-border-subtle">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-kage-accent-glow flex items-center justify-center">
                    <span className="text-sm font-medium text-kage-accent">1</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-kage-text">
                      Queue MPC Computation
                    </p>
                    <p className="text-xs text-kage-text-muted">
                      Submit to Arcium network for processing
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
                      Verify & Authorize
                    </p>
                    <p className="text-xs text-kage-text-muted">
                      MPC verifies claim and computes amount
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

interface WithdrawStepProps {
  position: SelectedPosition
  jobId: string | null
  onWithdraw: () => void
  onError: (error: string) => void
  onBack: () => void
}

const WithdrawStep: FC<WithdrawStepProps> = ({
  position,
  jobId,
  onWithdraw,
  onError,
  onBack,
}) => {
  const [loading, setLoading] = useState(false)

  const handleWithdraw = async () => {
    setLoading(true)
    try {
      // TODO: Execute withdrawal transaction
      await new Promise((r) => setTimeout(r, 1500))
      onWithdraw()
    } catch (err) {
      console.error('Withdraw error:', err)
      onError(err instanceof Error ? err.message : 'Withdrawal failed')
    } finally {
      setLoading(false)
    }
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
            <span className="text-kage-text-muted">Position</span>
            <span className="text-kage-text">#{position.positionId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-kage-text-muted">Job ID</span>
            <span className="text-kage-text font-mono text-xs">{jobId?.slice(0, 20)}...</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-kage-text-muted">Amount</span>
            <span className="text-kage-text">Encrypted (revealed on withdrawal)</span>
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

interface CompleteStepProps {
  txSignature: string | null
  onReset: () => void
}

const CompleteStep: FC<CompleteStepProps> = ({ txSignature, onReset }) => {
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
        {txSignature && (
          <p className="text-xs text-kage-text-dim mt-4 font-mono">
            Tx: {txSignature}
          </p>
        )}
        <Button variant="secondary" onClick={onReset} className="mt-8">
          Claim More Tokens
        </Button>
      </CardContent>
    </Card>
  )
}
