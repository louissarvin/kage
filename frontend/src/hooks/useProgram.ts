/**
 * useProgram Hook
 *
 * Provides access to the ShadowVest Anchor program instance.
 */

import { useMemo } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { AnchorProvider } from '@coral-xyz/anchor'
import { createProgram } from '@/lib/sdk'
import type { ShadowVestProgram } from '@/lib/sdk'

/**
 * Hook to get the Anchor program instance
 * Returns null if wallet is not connected
 */
export function useProgram(): ShadowVestProgram | null {
  const { connection } = useConnection()
  const wallet = useWallet()

  const program = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return null
    }

    // Create an AnchorWallet-compatible object
    const anchorWallet = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
    }

    return createProgram(connection, anchorWallet)
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions])

  return program
}

/**
 * Hook to get the Anchor provider
 * Returns null if wallet is not connected
 */
export function useProvider(): AnchorProvider | null {
  const { connection } = useConnection()
  const wallet = useWallet()

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return null
    }

    const anchorWallet = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
    }

    return new AnchorProvider(connection, anchorWallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    })
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions])

  return provider
}
