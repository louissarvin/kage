/**
 * Meta-Keys Vault SDK Functions
 *
 * Handles writing and reading stealth private keys to/from
 * the on-chain Arcium MPC vault.
 */

import { PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js'
import BN from 'bn.js'
import type { ShadowVestProgram } from './program'
import { api } from '../api'

// =============================================================================
// Types
// =============================================================================

export interface WriteMetaKeysResult {
  signature: string
  vaultPda: string
}

export interface MetaKeysRetrievedEvent {
  owner: PublicKey
  vault: PublicKey
  encryptedSpendLo: number[]
  encryptedSpendHi: number[]
  encryptedViewLo: number[]
  encryptedViewHi: number[]
  nonce: number[]
}

export interface ReadMetaKeysResult {
  signature: string
  // The decrypted keys are returned via event, not transaction result
  // Frontend must listen for MetaKeysRetrieved event and decrypt
  sessionPrivKeyHex: string // For decrypting event data
  computationOffset: string // For finding the computation account
}

export interface DecryptedMetaKeys {
  spendPrivKeyHex: string
  viewPrivKeyHex: string
}

// =============================================================================
// Write Meta-Keys to Vault
// =============================================================================

/**
 * Write stealth meta-keys to the on-chain Arcium vault
 *
 * This encrypts the stealth private keys via MPC and stores them
 * in a vault PDA. Only the owner can retrieve them later.
 *
 * @param program - ShadowVest program instance
 * @param spendPrivKeyHex - Spend private key (32 bytes as hex)
 * @param viewPrivKeyHex - View private key (32 bytes as hex)
 * @returns Transaction signature and vault PDA
 */
export async function writeMetaKeysToVault(
  program: ShadowVestProgram,
  spendPrivKeyHex: string,
  viewPrivKeyHex: string
): Promise<WriteMetaKeysResult> {
  const owner = program.provider.publicKey
  if (!owner) {
    throw new Error('Wallet not connected')
  }

  // Step 1: Call backend to prepare encrypted data
  console.log('Preparing vault write data...')
  const preparedData = await api.prepareVaultWrite(spendPrivKeyHex, viewPrivKeyHex)

  // Validate array lengths - must be exactly 32 bytes for [u8; 32]
  console.log('=== Validating prepared data ===')
  console.log('encryptedSpendLo length:', preparedData.encryptedSpendLo?.length)
  console.log('encryptedSpendHi length:', preparedData.encryptedSpendHi?.length)
  console.log('encryptedViewLo length:', preparedData.encryptedViewLo?.length)
  console.log('encryptedViewHi length:', preparedData.encryptedViewHi?.length)
  console.log('clientPubkey length:', preparedData.clientPubkey?.length)
  console.log('computationOffset:', preparedData.computationOffset)
  console.log('userNonce:', preparedData.userNonce)
  console.log('mxeNonce:', preparedData.mxeNonce)

  // Validate all arrays are exactly 32 bytes
  const arrays = [
    { name: 'encryptedSpendLo', arr: preparedData.encryptedSpendLo },
    { name: 'encryptedSpendHi', arr: preparedData.encryptedSpendHi },
    { name: 'encryptedViewLo', arr: preparedData.encryptedViewLo },
    { name: 'encryptedViewHi', arr: preparedData.encryptedViewHi },
    { name: 'clientPubkey', arr: preparedData.clientPubkey },
  ]

  for (const { name, arr } of arrays) {
    if (!arr || arr.length !== 32) {
      throw new Error(`Invalid ${name}: expected 32 bytes, got ${arr?.length ?? 'undefined'}`)
    }
    // Also validate each element is a valid u8
    for (let i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== 'number' || arr[i] < 0 || arr[i] > 255) {
        throw new Error(`Invalid ${name}[${i}]: expected u8 (0-255), got ${arr[i]}`)
      }
    }
  }
  console.log('=== All validations passed ===')

  // Step 2: Build accounts object
  const accounts = {
    payer: owner,
    owner: owner,
    metaKeysVault: new PublicKey(preparedData.vaultPda),
    signPdaAccount: new PublicKey(preparedData.signPda),
    mxeAccount: new PublicKey(preparedData.arciumAccounts.mxeAccount),
    mempoolAccount: new PublicKey(preparedData.arciumAccounts.mempoolAccount),
    executingPool: new PublicKey(preparedData.arciumAccounts.executingPool),
    computationAccount: new PublicKey(preparedData.arciumAccounts.computationAccount),
    compDefAccount: new PublicKey(preparedData.arciumAccounts.compDefAccount),
    clusterAccount: new PublicKey(preparedData.arciumAccounts.clusterAccount),
    poolAccount: new PublicKey(preparedData.arciumAccounts.poolAccount),
    clockAccount: new PublicKey(preparedData.arciumAccounts.clockAccount),
    systemProgram: SystemProgram.programId,
    arciumProgram: new PublicKey(preparedData.arciumAccounts.arciumProgram),
  }

  // Step 3: Add compute budget for Arcium MPC
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  })
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000,
  })

  // Step 4: Build and submit transaction
  console.log('Submitting write_meta_keys_to_vault transaction...')
  const signature = await program.methods
    .writeMetaKeysToVault(
      new BN(preparedData.computationOffset),
      preparedData.encryptedSpendLo,
      preparedData.encryptedSpendHi,
      preparedData.encryptedViewLo,
      preparedData.encryptedViewHi,
      preparedData.clientPubkey,
      new BN(preparedData.userNonce),
      new BN(preparedData.mxeNonce)
    )
    .accountsPartial(accounts)
    .preInstructions([modifyComputeUnits, addPriorityFee])
    .rpc({ commitment: 'confirmed' })

  console.log('Vault write transaction submitted:', signature)

  return {
    signature,
    vaultPda: preparedData.vaultPda,
  }
}

// =============================================================================
// Read Meta-Keys from Vault
// =============================================================================

/**
 * Initiate reading meta-keys from the on-chain Arcium vault
 *
 * This queues an MPC computation to decrypt the stored keys.
 * The decrypted keys are returned via a MetaKeysRetrieved event.
 *
 * @param program - ShadowVest program instance
 * @returns Transaction signature and session key for decrypting event
 */
export async function readMetaKeysFromVault(
  program: ShadowVestProgram
): Promise<ReadMetaKeysResult> {
  const owner = program.provider.publicKey
  if (!owner) {
    throw new Error('Wallet not connected')
  }

  // Step 1: Call backend to prepare session key
  console.log('Preparing vault read data...')
  const preparedData = await api.prepareVaultRead()

  // Step 2: Build accounts object
  const accounts = {
    payer: owner,
    owner: owner,
    metaKeysVault: new PublicKey(preparedData.vaultPda),
    signPdaAccount: new PublicKey(preparedData.signPda),
    mxeAccount: new PublicKey(preparedData.arciumAccounts.mxeAccount),
    mempoolAccount: new PublicKey(preparedData.arciumAccounts.mempoolAccount),
    executingPool: new PublicKey(preparedData.arciumAccounts.executingPool),
    computationAccount: new PublicKey(preparedData.arciumAccounts.computationAccount),
    compDefAccount: new PublicKey(preparedData.arciumAccounts.compDefAccount),
    clusterAccount: new PublicKey(preparedData.arciumAccounts.clusterAccount),
    poolAccount: new PublicKey(preparedData.arciumAccounts.poolAccount),
    clockAccount: new PublicKey(preparedData.arciumAccounts.clockAccount),
    systemProgram: SystemProgram.programId,
    arciumProgram: new PublicKey(preparedData.arciumAccounts.arciumProgram),
  }

  // Step 3: Add compute budget for Arcium MPC
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  })
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000,
  })

  // Step 4: Build and submit transaction
  console.log('Submitting read_meta_keys_from_vault transaction...')
  const signature = await program.methods
    .readMetaKeysFromVault(
      new BN(preparedData.computationOffset),
      preparedData.clientPubkey,
      new BN(preparedData.sessionNonce)
    )
    .accountsPartial(accounts)
    .preInstructions([modifyComputeUnits, addPriorityFee])
    .rpc({ commitment: 'confirmed' })

  console.log('Vault read transaction submitted:', signature)

  return {
    signature,
    sessionPrivKeyHex: preparedData.sessionPrivKeyHex,
    computationOffset: preparedData.computationOffset,
  }
}

// =============================================================================
// Wait for MetaKeysRetrieved Event
// =============================================================================

/**
 * Wait for the MetaKeysRetrieved event after a vault read
 *
 * @param program - ShadowVest program instance
 * @param timeoutMs - Timeout in milliseconds (default 5 minutes)
 * @returns The event data containing encrypted keys
 */
export async function waitForMetaKeysEvent(
  program: ShadowVestProgram,
  timeoutMs: number = 300000
): Promise<MetaKeysRetrievedEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for MetaKeysRetrieved event'))
    }, timeoutMs)

    const listenerId = program.addEventListener(
      'metaKeysRetrieved' as any,
      (event: any) => {
        clearTimeout(timeout)
        program.removeEventListener(listenerId)
        resolve(event as MetaKeysRetrievedEvent)
      }
    )
  })
}

// =============================================================================
// Decrypt Meta-Keys from Event
// =============================================================================

/**
 * Decrypt the meta-keys from a MetaKeysRetrieved event
 *
 * Uses the session private key to decrypt the MPC-encrypted keys.
 * Calls backend endpoint since @arcium-hq/client doesn't work in browser.
 *
 * @param event - The MetaKeysRetrieved event
 * @param sessionPrivKeyHex - Session private key (from prepareVaultRead)
 * @returns Decrypted stealth private keys
 */
export async function decryptMetaKeysFromEvent(
  event: MetaKeysRetrievedEvent,
  sessionPrivKeyHex: string
): Promise<DecryptedMetaKeys> {
  // Call backend to decrypt using Arcium crypto libs
  const result = await api.decryptVaultEvent({
    sessionPrivKeyHex,
    encryptedSpendLo: event.encryptedSpendLo,
    encryptedSpendHi: event.encryptedSpendHi,
    encryptedViewLo: event.encryptedViewLo,
    encryptedViewHi: event.encryptedViewHi,
    nonce: event.nonce,
  })

  return {
    spendPrivKeyHex: result.spendPrivKeyHex,
    viewPrivKeyHex: result.viewPrivKeyHex,
  }
}

// =============================================================================
// Check Vault Status
// =============================================================================

/**
 * Check if a meta-keys vault exists for an owner
 *
 * @param program - ShadowVest program instance
 * @param owner - Owner public key
 * @returns Vault info if exists, null otherwise
 */
export async function getMetaKeysVault(
  program: ShadowVestProgram,
  owner: PublicKey
): Promise<{
  isInitialized: boolean
  owner: PublicKey
} | null> {
  const [vaultPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('meta_keys_vault'), owner.toBuffer()],
    program.programId
  )

  // Diagnostic logging
  console.log('=== getMetaKeysVault Diagnostic ===')
  console.log('Owner address:', owner.toBase58())
  console.log('Program ID:', program.programId.toBase58())
  console.log('Derived vault PDA:', vaultPda.toBase58())
  console.log('PDA bump:', bump)

  try {
    const account = await (program.account as any).metaKeysVault.fetch(vaultPda)
    console.log('Vault account FOUND!')
    console.log('  isInitialized:', account.isInitialized)
    console.log('  owner:', account.owner?.toBase58())
    console.log('  ciphertexts length:', account.ciphertexts?.length)
    console.log('=== End Diagnostic ===')
    return {
      isInitialized: account.isInitialized,
      owner: account.owner,
    }
  } catch (err) {
    console.log('Vault account NOT FOUND or fetch error')
    console.log('  Error:', err instanceof Error ? err.message : String(err))
    console.log('=== End Diagnostic ===')
    return null
  }
}

/**
 * Find the meta-keys vault PDA for an owner
 *
 * @param programId - ShadowVest program ID
 * @param owner - Owner public key
 * @returns Vault PDA and bump
 */
export function findMetaKeysVaultPda(
  programId: PublicKey,
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('meta_keys_vault'), owner.toBuffer()],
    programId
  )
}
