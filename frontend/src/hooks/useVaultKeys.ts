/**
 * useVaultKeys Hook
 *
 * Manages stealth private key retrieval from Arcium MPC vault.
 * Automatically handles the vault read flow when keys are needed.
 */

import { useState, useCallback, useEffect } from 'react'
import { useProgram } from './useProgram'
import {
  readMetaKeysFromVault,
  waitForMetaKeysEvent,
  decryptMetaKeysFromEvent,
  getMetaKeysVault,
} from '@/lib/sdk'
import {
  getCachedStealthKeys,
  cacheStealthKeys,
  hasValidCachedStealthKeys,
  type CachedStealthKeys,
} from '@/lib/stealth-key-cache'

export interface UseVaultKeysResult {
  // State
  keys: CachedStealthKeys | null
  hasKeys: boolean
  isLoading: boolean
  error: string | null
  status: 'idle' | 'checking-vault' | 'reading-vault' | 'waiting-event' | 'decrypting' | 'ready' | 'error'

  // Actions
  retrieveKeys: () => Promise<CachedStealthKeys | null>
  clearKeys: () => void
}

/**
 * Hook to manage stealth private key retrieval from Arcium vault
 *
 * The flow is:
 * 1. Check if keys are cached locally
 * 2. If not, check if vault exists on-chain
 * 3. If vault exists, trigger read flow:
 *    a. Submit read_meta_keys transaction
 *    b. Wait for MetaKeysRetrieved event
 *    c. Decrypt event data
 *    d. Cache keys locally
 */
export function useVaultKeys(): UseVaultKeysResult {
  const program = useProgram()

  const [keys, setKeys] = useState<CachedStealthKeys | null>(() => getCachedStealthKeys())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<UseVaultKeysResult['status']>(
    hasValidCachedStealthKeys() ? 'ready' : 'idle'
  )

  // Check for cached keys on mount
  useEffect(() => {
    const cached = getCachedStealthKeys()
    if (cached) {
      setKeys(cached)
      setStatus('ready')
    }
  }, [])

  /**
   * Retrieve stealth keys from Arcium vault
   */
  const retrieveKeys = useCallback(async (): Promise<CachedStealthKeys | null> => {
    // First check if we already have cached keys
    const cached = getCachedStealthKeys()
    if (cached) {
      setKeys(cached)
      setStatus('ready')
      return cached
    }

    if (!program) {
      setError('Wallet not connected')
      setStatus('error')
      return null
    }

    const owner = program.provider.publicKey
    if (!owner) {
      setError('Wallet not connected')
      setStatus('error')
      return null
    }

    setIsLoading(true)
    setError(null)

    try {
      // Step 1: Check if vault exists
      setStatus('checking-vault')
      console.log('=== useVaultKeys.retrieveKeys ===')
      console.log('Connected wallet (owner):', owner.toBase58())
      console.log('Program ID:', program.programId.toBase58())
      console.log('Checking if meta-keys vault exists...')

      const vault = await getMetaKeysVault(program, owner)

      console.log('Vault lookup result:', vault)

      if (!vault) {
        console.log('ERROR: Vault account does not exist on-chain')
        console.log('This means either:')
        console.log('  1. writeMetaKeysToVault was never called')
        console.log('  2. The write transaction failed')
        console.log('  3. Wrong wallet connected (different from setup)')
        setError(
          'Meta-keys vault not found. Please complete employee setup first. ' +
          'Go to Dashboard to generate and store your stealth keys.'
        )
        setStatus('error')
        return null
      }

      if (!vault.isInitialized) {
        console.log('ERROR: Vault exists but isInitialized=false')
        console.log('This means the MPC callback has not completed yet')
        console.log('The Arcium MPC might still be processing or failed')
        setError(
          'Meta-keys vault exists but is not initialized. ' +
          'The MPC callback may still be processing. Please wait and try again.'
        )
        setStatus('error')
        return null
      }

      console.log('Vault found and initialized! Proceeding with read...')

      // Step 2: Submit read transaction
      setStatus('reading-vault')
      console.log('Submitting vault read transaction...')

      const readResult = await readMetaKeysFromVault(program)
      console.log('Read transaction submitted:', readResult.signature)

      // Step 3: Wait for event
      setStatus('waiting-event')
      console.log('Waiting for MetaKeysRetrieved event...')

      // Use a reasonable timeout (2 minutes for MPC processing)
      const event = await waitForMetaKeysEvent(program, 120000)
      console.log('Event received!')

      // Step 4: Decrypt keys
      setStatus('decrypting')
      console.log('Decrypting keys...')

      const decrypted = await decryptMetaKeysFromEvent(event, readResult.sessionPrivKeyHex)
      console.log('Keys decrypted successfully!')

      // Step 5: Cache keys
      cacheStealthKeys(decrypted.spendPrivKeyHex, decrypted.viewPrivKeyHex)

      const cachedKeys = getCachedStealthKeys()
      setKeys(cachedKeys)
      setStatus('ready')

      return cachedKeys
    } catch (err) {
      console.error('Failed to retrieve stealth keys:', err)
      const message = err instanceof Error ? err.message : 'Failed to retrieve stealth keys'
      setError(message)
      setStatus('error')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [program])

  /**
   * Clear cached keys
   */
  const clearKeys = useCallback(() => {
    sessionStorage.removeItem('shadowvest_stealth_keys')
    setKeys(null)
    setStatus('idle')
    setError(null)
  }, [])

  return {
    keys,
    hasKeys: !!keys,
    isLoading,
    error,
    status,
    retrieveKeys,
    clearKeys,
  }
}
