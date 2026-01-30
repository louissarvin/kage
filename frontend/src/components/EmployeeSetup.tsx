/**
 * Employee Setup Component
 *
 * Single-step onboarding: enter username → creates stealth keys + link together.
 */

import { useState, type FC } from 'react'
import {
  Link as LinkIcon,
  Loader2,
  AlertCircle,
  Copy,
  ExternalLink,
  CheckCircle,
  Sparkles,
} from 'lucide-react'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { Card, CardContent, CardHeader, Button, Input } from '@/components/ui'
import { useLinks, useSlugAvailability } from '@/hooks'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'

interface EmployeeSetupProps {
  onComplete?: () => void
}

export const EmployeeSetup: FC<EmployeeSetupProps> = ({ onComplete }) => {
  const { user, refreshUser } = useAuth()
  const { links, loading: linksLoading, refresh: refreshLinks } = useLinks()
  const { isAvailable, reason, loading: checkLoading, check } = useSlugAvailability()

  const [slug, setSlug] = useState('')
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
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
        const spendKeypair = Keypair.generate()
        const viewKeypair = Keypair.generate()

        const metaSpendPub = bs58.encode(spendKeypair.publicKey.toBytes())
        const metaViewPub = bs58.encode(viewKeypair.publicKey.toBytes())

        // Register with backend
        await api.registerStealthKeys(wallet.id, metaSpendPub, metaViewPub)

        // Store private keys locally (MVP only - production uses Arcium)
        localStorage.setItem(
          `stealth_keys_${wallet.address}`,
          JSON.stringify({
            spendPriv: bs58.encode(spendKeypair.secretKey),
            viewPriv: bs58.encode(viewKeypair.secretKey),
          })
        )

        // Refresh user to get updated wallet with keys
        await refreshUser()
      }

      // Step 2: Create the link
      await api.createLink(slug, wallet.id, label || undefined)

      // Refresh data
      await refreshLinks()
      await refreshUser()

      // Clear form
      setSlug('')
      setLabel('')

      onComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link')
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
                ? (hasStealthKeys ? 'Creating Link...' : 'Setting up secure keys...')
                : 'Create Link'
              }
            </Button>
          </div>

          {/* Info box */}
          <div className="p-4 rounded-xl bg-kage-subtle/50 border border-kage-border-subtle">
            <p className="text-xs text-kage-text-dim">
              <strong className="text-kage-text-muted">How it works:</strong> When you create a link,
              we generate secure stealth keys that enable private payments. Employers can find you
              by your username, but your actual payment addresses remain hidden on the blockchain.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
