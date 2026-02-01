/**
 * Employee Setup Component
 *
 * Single-step onboarding: enter username → creates stealth keys + link together.
 * Stealth private keys are stored in on-chain Arcium MPC vault for secure, non-custodial storage.
 */

import { useState, type FC } from 'react'
import {
  Loader2,
  AlertCircle,
  Copy,
  ExternalLink,
  CheckCircle,
  Shield,
} from 'lucide-react'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { Card, CardContent, CardHeader, Button, Input } from '@/components/ui'
import { useLinks, useSlugAvailability } from '@/hooks'
import { useMetaKeysVault } from '@/hooks/useMetaKeysVault'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'

interface EmployeeSetupProps {
  onComplete?: () => void
}

export const EmployeeSetup: FC<EmployeeSetupProps> = ({ onComplete }) => {
  const { user, refreshUser } = useAuth()
  const { links, loading: linksLoading, refresh: refreshLinks } = useLinks()
  const { isAvailable, reason, loading: checkLoading, check } = useSlugAvailability()
  const { storeMetaKeys } = useMetaKeysVault()

  const [slug, setSlug] = useState('')
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [setupStep, setSetupStep] = useState<'idle' | 'generating' | 'storing' | 'linking'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // Check if user already has stealth keys
  const wallet = user?.wallets[0]
  const hasStealthKeys = !!(wallet?.metaSpendPub && wallet?.metaViewPub)

  const handleSlugChange = (value: string) => {
    // Sanitize: lowercase, alphanumeric and hyphens only
    const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setSlug(sanitized)
    setError(null)
    if (sanitized.length >= 3) {
      check(sanitized)
    }
  }

  const handleCreateLink = async () => {
    if (!slug || !isAvailable || !wallet) return

    setCreating(true)
    setError(null)

    try {
      // Step 1: Generate stealth keys if not already registered
      if (!hasStealthKeys) {
        setSetupStep('generating')
        console.log('=== EmployeeSetup: Generating Stealth Keys ===')
        console.log('Wallet address:', wallet.address)
        console.log('Wallet ID:', wallet.id)

        const spendKeypair = Keypair.generate()
        const viewKeypair = Keypair.generate()

        const metaSpendPub = bs58.encode(spendKeypair.publicKey.toBytes())
        const metaViewPub = bs58.encode(viewKeypair.publicKey.toBytes())

        // Get the 32-byte private key seeds (first 32 bytes of secretKey)
        const spendPrivKeyHex = Buffer.from(spendKeypair.secretKey.slice(0, 32)).toString('hex')
        const viewPrivKeyHex = Buffer.from(viewKeypair.secretKey.slice(0, 32)).toString('hex')

        console.log('Generated stealth keys:')
        console.log('  metaSpendPub:', metaSpendPub)
        console.log('  metaViewPub:', metaViewPub)
        console.log('  spendPrivKeyHex (first 16 chars):', spendPrivKeyHex.slice(0, 16) + '...')
        console.log('  viewPrivKeyHex (first 16 chars):', viewPrivKeyHex.slice(0, 16) + '...')

        // Register public keys with backend
        console.log('Registering public keys with backend...')
        await api.registerStealthKeys(wallet.id, metaSpendPub, metaViewPub)
        console.log('Public keys registered with backend!')

        // Store private keys in on-chain Arcium MPC vault
        // This encrypts the keys via MPC - only the owner can retrieve them
        setSetupStep('storing')
        console.log('=== Storing Private Keys in Arcium Vault ===')
        console.log('Calling storeMetaKeys...')
        const storeResult = await storeMetaKeys(spendPrivKeyHex, viewPrivKeyHex)
        console.log('storeMetaKeys returned:', storeResult)
        console.log('Stealth keys stored in vault successfully!')
        console.log('=== End EmployeeSetup ===')

        // Refresh user to get updated wallet with keys
        await refreshUser()
      }

      // Step 2: Create the link
      setSetupStep('linking')
      await api.createLink(slug, wallet.id, label || undefined)

      // Refresh data
      await refreshLinks()
      await refreshUser()

      // Clear form
      setSlug('')
      setLabel('')
      setSetupStep('idle')

      onComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link')
      setSetupStep('idle')
    } finally {
      setCreating(false)
    }
  }

  // Register stealth keys only (for users who already have links but no keys)
  const handleRegisterKeysOnly = async () => {
    if (!wallet || hasStealthKeys) return

    setCreating(true)
    setError(null)

    try {
      setSetupStep('generating')
      console.log('=== EmployeeSetup: Registering Stealth Keys Only ===')
      console.log('Wallet address:', wallet.address)

      const spendKeypair = Keypair.generate()
      const viewKeypair = Keypair.generate()

      const metaSpendPub = bs58.encode(spendKeypair.publicKey.toBytes())
      const metaViewPub = bs58.encode(viewKeypair.publicKey.toBytes())

      const spendPrivKeyHex = Buffer.from(spendKeypair.secretKey.slice(0, 32)).toString('hex')
      const viewPrivKeyHex = Buffer.from(viewKeypair.secretKey.slice(0, 32)).toString('hex')

      console.log('Generated stealth keys')

      // Register public keys with backend
      console.log('Registering public keys with backend...')
      await api.registerStealthKeys(wallet.id, metaSpendPub, metaViewPub)
      console.log('Public keys registered!')

      // Store private keys in on-chain Arcium MPC vault
      setSetupStep('storing')
      console.log('Storing private keys in Arcium vault...')
      const storeResult = await storeMetaKeys(spendPrivKeyHex, viewPrivKeyHex)
      console.log('Vault storage result:', storeResult)

      // Refresh user data
      await refreshUser()
      setSetupStep('idle')

      console.log('=== Stealth keys registered successfully! ===')
      onComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register stealth keys')
      setSetupStep('idle')
    } finally {
      setCreating(false)
    }
  }

  const copyLink = (fullUrl: string, linkId: string) => {
    navigator.clipboard.writeText(fullUrl)
    setCopied(linkId)
    setTimeout(() => setCopied(null), 2000)
  }

  if (linksLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="w-8 h-8 text-kage-accent animate-spin mx-auto" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Existing links */}
      {links.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-kage-text">Your Links</h3>
            <p className="text-sm text-kage-text-muted">
              Share these with employers to receive private payments
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {links.map((link) => (
              <div
                key={link.id}
                className="p-4 rounded-xl bg-kage-subtle flex items-center justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-kage-text truncate">
                    {link.label || link.slug}
                  </p>
                  <p className="text-sm text-kage-accent font-mono truncate">
                    {link.fullUrl}
                  </p>
                  {link.positionsReceived > 0 && (
                    <p className="text-xs text-kage-text-dim mt-1">
                      {link.positionsReceived} position{link.positionsReceived !== 1 ? 's' : ''} received
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyLink(link.fullUrl, link.id)}
                  >
                    {copied === link.id ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(link.fullUrl, '_blank')}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Register keys only - for users who have links but no stealth keys */}
      {links.length > 0 && !hasStealthKeys && (
        <Card className="border-kage-accent/30">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-kage-accent" />
              <div>
                <h3 className="text-lg font-semibold text-kage-text">
                  Register Stealth Keys
                </h3>
                <p className="text-sm text-kage-text-muted">
                  Your stealth keys need to be set up to receive private payments
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 mb-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              </div>
            )}
            <Button
              variant="primary"
              onClick={handleRegisterKeysOnly}
              loading={creating}
              disabled={creating}
              className="w-full"
            >
              {creating
                ? (setupStep === 'generating'
                    ? 'Generating secure keys...'
                    : setupStep === 'storing'
                    ? 'Storing keys on-chain (MPC)...'
                    : 'Processing...')
                : 'Register Stealth Keys Now'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create new link */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">

            <div>
              <h3 className="text-lg font-semibold text-kage-text">
                {links.length === 0 ? 'Create Your Payment Link' : 'Create Another Link'}
              </h3>
              <p className="text-sm text-kage-text-muted">
                Get a shareable link for employers to pay you privately
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          )}

          <Input
            label="Choose your username"
            placeholder="your-name"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            prefix="kage.ink/"
            hint={
              slug.length === 0
                ? 'This is how employers will find you'
                : slug.length < 3
                  ? 'Minimum 3 characters'
                  : checkLoading
                    ? 'Checking availability...'
                    : isAvailable
                      ? 'Available!'
                      : reason || 'Not available'
            }
            error={slug.length >= 3 && isAvailable === false}
            success={slug.length >= 3 && isAvailable === true}
          />

          <Input
            label="Display name (optional)"
            placeholder="Alice Smith"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            hint="Shown to employers when they look you up"
          />

          <div className="pt-2">
            <Button
              variant="primary"
              onClick={handleCreateLink}
              loading={creating}
              disabled={!slug || slug.length < 3 || !isAvailable || creating}
              className="w-full"
            >
              {creating
                ? (setupStep === 'generating'
                    ? 'Generating secure keys...'
                    : setupStep === 'storing'
                    ? 'Storing keys on-chain (MPC)...'
                    : setupStep === 'linking'
                    ? 'Creating link...'
                    : 'Setting up...')
                : 'Create Link'
              }
            </Button>
          </div>

          {/* Info box */}
          <div className="p-4 rounded-xl bg-kage-subtle/50 border border-kage-border-subtle">
            <div className="flex items-start gap-3">
              <Shield className="w-4 h-4 text-kage-accent flex-shrink-0 mt-0.5" />
              <p className="text-xs text-kage-text-dim">
                <strong className="text-kage-text-muted">Secure & Non-Custodial:</strong> Your stealth
                private keys are encrypted via Arcium MPC and stored on-chain. Only you can decrypt
                them to claim payments. No one else - not even us - can access your keys.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
