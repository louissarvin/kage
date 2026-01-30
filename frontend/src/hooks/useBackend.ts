/**
 * Backend API Hooks
 *
 * React hooks for interacting with the ShadowVest backend.
 */

import { useState, useEffect, useCallback } from 'react'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { api, type ApiLink, type ApiMetaAddress } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

// =============================================================================
// useLinks - Manage user's links
// =============================================================================

export interface UseLinksResult {
  links: ApiLink[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createLink: (slug: string, label?: string) => Promise<ApiLink | null>
  deleteLink: (linkId: string) => Promise<boolean>
}

export function useLinks(): UseLinksResult {
  const { user, isAuthenticated } = useAuth()
  const [links, setLinks] = useState<ApiLink[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return

    setLoading(true)
    setError(null)

    try {
      const data = await api.getMyLinks()
      setLinks(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch links')
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createLink = useCallback(
    async (slug: string, label?: string): Promise<ApiLink | null> => {
      if (!user?.wallets[0]) {
        setError('No wallet found')
        return null
      }

      // Check if wallet has stealth keys
      const wallet = user.wallets[0]
      if (!wallet.metaSpendPub || !wallet.metaViewPub) {
        setError('Please register stealth keys first')
        return null
      }

      try {
        const link = await api.createLink(slug, wallet.id, label)
        await refresh()
        return link
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create link')
        return null
      }
    },
    [user, refresh]
  )

  const deleteLink = useCallback(
    async (linkId: string): Promise<boolean> => {
      try {
        await api.deleteLink(linkId)
        await refresh()
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete link')
        return false
      }
    },
    [refresh]
  )

  return { links, loading, error, refresh, createLink, deleteLink }
}

// =============================================================================
// useStealthKeys - Manage stealth key registration
// =============================================================================

export interface UseStealthKeysResult {
  hasKeys: boolean
  metaSpendPub: string | null
  metaViewPub: string | null
  loading: boolean
  error: string | null
  registerKeys: () => Promise<boolean>
  checkKeys: () => Promise<void>
}

export function useStealthKeys(): UseStealthKeysResult {
  const { user, refreshUser } = useAuth()
  const [hasKeys, setHasKeys] = useState(false)
  const [metaSpendPub, setMetaSpendPub] = useState<string | null>(null)
  const [metaViewPub, setMetaViewPub] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkKeys = useCallback(async () => {
    if (!user?.wallets[0]) return

    const wallet = user.wallets[0]
    setHasKeys(!!(wallet.metaSpendPub && wallet.metaViewPub))
    setMetaSpendPub(wallet.metaSpendPub)
    setMetaViewPub(wallet.metaViewPub)
  }, [user])

  useEffect(() => {
    checkKeys()
  }, [checkKeys])

  const registerKeys = useCallback(async (): Promise<boolean> => {
    if (!user?.wallets[0]) {
      setError('No wallet found')
      return false
    }

    const wallet = user.wallets[0]

    if (wallet.metaSpendPub && wallet.metaViewPub) {
      setError('Stealth keys already registered')
      return false
    }

    setLoading(true)
    setError(null)

    try {
      // Generate stealth meta keys (client-side)
      const spendKeypair = Keypair.generate()
      const viewKeypair = Keypair.generate()

      const newMetaSpendPub = bs58.encode(spendKeypair.publicKey.toBytes())
      const newMetaViewPub = bs58.encode(viewKeypair.publicKey.toBytes())

      // Register public keys with backend
      await api.registerStealthKeys(wallet.id, newMetaSpendPub, newMetaViewPub)

      // TODO: Store private keys in Arcium vault on-chain
      // For MVP, we'll need to handle this separately
      // The private keys should be stored via writeMetaKeysToVault instruction

      // Store private keys temporarily in localStorage (MVP only!)
      // In production, use Arcium on-chain vault
      localStorage.setItem(
        `stealth_keys_${wallet.address}`,
        JSON.stringify({
          spendPriv: bs58.encode(spendKeypair.secretKey),
          viewPriv: bs58.encode(viewKeypair.secretKey),
        })
      )

      // Refresh user data
      await refreshUser()

      setHasKeys(true)
      setMetaSpendPub(newMetaSpendPub)
      setMetaViewPub(newMetaViewPub)

      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register stealth keys')
      return false
    } finally {
      setLoading(false)
    }
  }, [user, refreshUser])

  return {
    hasKeys,
    metaSpendPub,
    metaViewPub,
    loading,
    error,
    registerKeys,
    checkKeys,
  }
}

// =============================================================================
// useLookupEmployee - Lookup employee for position creation
// =============================================================================

export interface UseLookupEmployeeResult {
  employee: {
    slug: string
    label: string | null
    metaAddress: ApiMetaAddress
  } | null
  loading: boolean
  error: string | null
  lookup: (slug: string) => Promise<boolean>
  clear: () => void
}

export function useLookupEmployee(): UseLookupEmployeeResult {
  const [employee, setEmployee] = useState<{
    slug: string
    label: string | null
    metaAddress: ApiMetaAddress
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lookup = useCallback(async (slug: string): Promise<boolean> => {
    setLoading(true)
    setError(null)

    try {
      const data = await api.lookupEmployee(slug)
      setEmployee(data)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Employee not found')
      setEmployee(null)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    setEmployee(null)
    setError(null)
  }, [])

  return { employee, loading, error, lookup, clear }
}

// =============================================================================
// useSlugAvailability - Check if link slug is available
// =============================================================================

export interface UseSlugAvailabilityResult {
  isAvailable: boolean | null
  reason: string | null
  loading: boolean
  check: (slug: string) => Promise<void>
}

export function useSlugAvailability(): UseSlugAvailabilityResult {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const check = useCallback(async (slug: string) => {
    if (!slug || slug.length < 3) {
      setIsAvailable(null)
      setReason(null)
      return
    }

    setLoading(true)

    try {
      const data = await api.checkSlugAvailable(slug)
      setIsAvailable(data.available)
      setReason(data.reason)
    } catch (err) {
      setIsAvailable(null)
      setReason('Error checking availability')
    } finally {
      setLoading(false)
    }
  }, [])

  return { isAvailable, reason, loading, check }
}
