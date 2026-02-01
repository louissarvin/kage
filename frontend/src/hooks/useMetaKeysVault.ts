/**
 * useMetaKeysVault Hook
 *
 * Provides functions to store and retrieve stealth private keys
 * from the on-chain Arcium MPC vault.
 */

import { useState, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useProgram } from './useProgram'
import {
  writeMetaKeysToVault,
  readMetaKeysFromVault,
  waitForMetaKeysEvent,
  decryptMetaKeysFromEvent,
  getMetaKeysVault,
  type WriteMetaKeysResult,
  type DecryptedMetaKeys,
} from '@/lib/sdk'

export interface UseMetaKeysVaultResult {
  // State
  loading: boolean
  error: string | null
  vaultExists: boolean | null

  // Actions
  storeMetaKeys: (spendPrivKeyHex: string, viewPrivKeyHex: string) => Promise<WriteMetaKeysResult>
  retrieveMetaKeys: () => Promise<DecryptedMetaKeys>
  checkVaultExists: () => Promise<boolean>
}

/**
 * Hook to manage meta-keys vault operations
 */
export function useMetaKeysVault(): UseMetaKeysVaultResult {
  const { publicKey } = useWallet()
  const program = useProgram()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)

  /**
   * Check if the user's vault exists on-chain
   */
  const checkVaultExists = useCallback(async (): Promise<boolean> => {
    if (!program || !publicKey) {
      setVaultExists(false)
      return false
    }

    try {
      const vault = await getMetaKeysVault(program, publicKey)
      const exists = vault !== null && vault.isInitialized
      setVaultExists(exists)
      return exists
    } catch (err) {
      console.error('Failed to check vault:', err)
      setVaultExists(false)
      return false
    }
  }, [program, publicKey])

  /**
   * Store stealth private keys in the on-chain vault
   *
   * This encrypts the keys via Arcium MPC and stores them
   * in a vault PDA. Only the owner can retrieve them later.
   */
  const storeMetaKeys = useCallback(
    async (spendPrivKeyHex: string, viewPrivKeyHex: string): Promise<WriteMetaKeysResult> => {
      if (!program) {
        throw new Error('Program not initialized')
      }

      setLoading(true)
      setError(null)

      try {
        console.log('=== useMetaKeysVault.storeMetaKeys ===')
        console.log('Program ID:', program.programId.toBase58())
        console.log('Owner:', program.provider.publicKey?.toBase58())
        console.log('Storing meta-keys in on-chain vault...')

        const result = await writeMetaKeysToVault(program, spendPrivKeyHex, viewPrivKeyHex)
        console.log('writeMetaKeysToVault completed!')
        console.log('  Transaction signature:', result.signature)
        console.log('  Vault PDA:', result.vaultPda)

        // Wait for MPC callback to complete (vault gets initialized)
        // This polls the vault account state until isInitialized is true
        console.log('Waiting for MPC callback to initialize vault...')
        console.log('This polls the vault account until isInitialized=true')
        await waitForVaultInitialized(program, result.vaultPda)

        setVaultExists(true)
        console.log('Meta-keys stored successfully!')
        console.log('=== End storeMetaKeys ===')
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to store meta-keys'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [program]
  )

  /**
   * Retrieve stealth private keys from the on-chain vault
   *
   * This queues an MPC computation to decrypt the stored keys,
   * waits for the MetaKeysRetrieved event, and decrypts the result.
   */
  const retrieveMetaKeys = useCallback(async (): Promise<DecryptedMetaKeys> => {
    if (!program) {
      throw new Error('Program not initialized')
    }

    setLoading(true)
    setError(null)

    try {
      console.log('Retrieving meta-keys from on-chain vault...')

      // Step 1: Queue the read computation
      const readResult = await readMetaKeysFromVault(program)

      // Step 2: Wait for the MetaKeysRetrieved event
      console.log('Waiting for MPC callback with decrypted keys...')
      const event = await waitForMetaKeysEvent(program, 300000) // 5 min timeout

      // Step 3: Decrypt the event data using session key
      console.log('Decrypting meta-keys from event...')
      const decrypted = await decryptMetaKeysFromEvent(event, readResult.sessionPrivKeyHex)

      console.log('Meta-keys retrieved successfully!')
      return decrypted
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retrieve meta-keys'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [program])

  return {
    loading,
    error,
    vaultExists,
    storeMetaKeys,
    retrieveMetaKeys,
    checkVaultExists,
  }
}

/**
 * Helper to wait for vault to be initialized by MPC callback
 * Polls the vault account state until isInitialized is true
 */
async function waitForVaultInitialized(
  program: any,
  vaultPda: string,
  timeoutMs: number = 300000, // 5 minutes
  pollIntervalMs: number = 3000 // 3 seconds
): Promise<void> {
  const { PublicKey } = await import('@solana/web3.js')
  const vaultPubkey = new PublicKey(vaultPda)
  const startTime = Date.now()

  console.log('=== waitForVaultInitialized ===')
  console.log('Vault PDA:', vaultPda)
  console.log('Timeout:', timeoutMs, 'ms')
  console.log('Poll interval:', pollIntervalMs, 'ms')
  console.log('Waiting for vault initialization via MPC callback...')
  console.log('This may take up to a few minutes...')

  let pollCount = 0
  while (Date.now() - startTime < timeoutMs) {
    pollCount++
    try {
      const account = await (program.account as any).metaKeysVault.fetch(vaultPubkey)
      console.log(`Poll #${pollCount}: Account found!`)
      console.log('  isInitialized:', account.isInitialized)
      console.log('  owner:', account.owner?.toBase58())

      if (account && account.isInitialized) {
        console.log('Vault initialized successfully!')
        console.log('=== End waitForVaultInitialized (SUCCESS) ===')
        return
      }
      console.log('  Vault exists but not initialized yet, continuing to poll...')
    } catch (err) {
      // Account doesn't exist yet, keep polling
      if (pollCount === 1 || pollCount % 5 === 0) {
        console.log(`Poll #${pollCount}: Account not found yet (this is expected initially)`)
      }
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    if (elapsed % 15 === 0 && elapsed > 0) {
      console.log(`Still waiting for MPC callback... (${elapsed}s elapsed, ${pollCount} polls)`)
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  console.log('=== End waitForVaultInitialized (TIMEOUT) ===')
  throw new Error(
    'Timeout waiting for vault initialization. ' +
    'The MPC callback may have failed. Please try again.'
  )
}
