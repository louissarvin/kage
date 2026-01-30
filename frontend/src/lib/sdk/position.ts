/**
 * Position SDK
 *
 * Functions for creating and managing vesting positions.
 * Arcium MPC encryption is handled by the backend (Node.js) via the relay endpoint.
 */

import { PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  findVaultAuthorityPda,
  findVaultPda,
  findClaimAuthorizationPda,
  BN,
} from './program'
import type {
  ShadowVestProgram,
  VestingPosition,
  VestingSchedule,
} from './program'
import { fetchOrganization, fetchSchedule } from './organization'
import type { PreparePositionOnChainResponse } from '../api'

// =============================================================================
// Position Management
// =============================================================================

export interface CreatePositionParams {
  scheduleId: number
  beneficiaryCommitment: Uint8Array // 32-byte commitment hash
  encryptedAmount: Uint8Array // Encrypted with MXE public key
  clientPubkey: Uint8Array // Client's x25519 public key
  nonce: BN
}

/**
 * Create a beneficiary commitment from stealth public keys
 * This is a hash of the meta-address that the employee can prove they control
 */
export async function createBeneficiaryCommitment(
  metaSpendPub: string,
  metaViewPub: string
): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(metaSpendPub + metaViewPub)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer)
}

/**
 * Encode amount as 32-byte array (for non-encrypted fallback)
 */
export function encodeAmount(amount: BN): Uint8Array {
  const bytes = new Uint8Array(32)
  const amountBytes = amount.toArray('le', 8) // Little-endian, 8 bytes (u64)
  bytes.set(amountBytes, 0)
  return bytes
}

/**
 * Create a vesting position using pre-encrypted data from the backend relay
 *
 * The backend handles Arcium MPC encryption since @arcium-hq/client requires Node.js.
 * This function builds and submits the transaction using the prepared encrypted data.
 */
export async function createPositionWithPreparedData(
  program: ShadowVestProgram,
  organization: PublicKey,
  preparedData: PreparePositionOnChainResponse
): Promise<{ signature: string; positionId: number }> {
  const admin = program.provider.publicKey!

  // Convert string pubkeys back to PublicKey objects
  const position = new PublicKey(preparedData.positionPda)
  const schedule = new PublicKey(preparedData.schedulePda)
  const signPda = new PublicKey(preparedData.signPda)

  // Arcium accounts from prepared data
  const arciumAccounts = preparedData.arciumAccounts

  // Convert computation offset and nonce from strings
  const computationOffset = new BN(preparedData.computationOffset)
  const nonce = new BN(preparedData.nonce)

  // Add compute budget instructions for Arcium MPC
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  })
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000,
  })

  // Build accounts for the instruction
  const accounts = {
    payer: admin,
    admin,
    organization,
    schedule,
    position,
    signPdaAccount: signPda,
    mxeAccount: new PublicKey(arciumAccounts.mxeAccount),
    mempoolAccount: new PublicKey(arciumAccounts.mempoolAccount),
    executingPool: new PublicKey(arciumAccounts.executingPool),
    computationAccount: new PublicKey(arciumAccounts.computationAccount),
    compDefAccount: new PublicKey(arciumAccounts.compDefAccount),
    clusterAccount: new PublicKey(arciumAccounts.clusterAccount),
    poolAccount: new PublicKey(arciumAccounts.poolAccount),
    clockAccount: new PublicKey(arciumAccounts.clockAccount),
    systemProgram: SystemProgram.programId,
    arciumProgram: new PublicKey(arciumAccounts.arciumProgram),
  }

  console.log('Creating position with Arcium MPC (via backend relay)...')
  console.log('Position PDA:', position.toBase58())
  console.log('Schedule PDA:', schedule.toBase58())

  const signature = await program.methods
    .createVestingPosition(
      computationOffset,
      preparedData.beneficiaryCommitment as number[],
      preparedData.encryptedAmount as number[],
      preparedData.clientPubkey as number[],
      nonce
    )
    .accountsPartial(accounts)
    .preInstructions([modifyComputeUnits, addPriorityFee])
    .rpc({ commitment: 'confirmed' })

  console.log('Position created! Signature:', signature)
  console.log('Waiting for Arcium MPC callback to finalize...')

  return { signature, positionId: preparedData.positionId }
}

/**
 * Fetch vesting position account data
 */
export async function fetchPosition(
  program: ShadowVestProgram,
  position: PublicKey
): Promise<VestingPosition | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = await (program.account as any).vestingPosition.fetch(position)
    return account as VestingPosition
  } catch {
    return null
  }
}

/**
 * Fetch all positions for an organization
 */
export async function fetchPositionsByOrganization(
  program: ShadowVestProgram,
  organization: PublicKey
): Promise<Array<{ publicKey: PublicKey; account: VestingPosition }>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await (program.account as any).vestingPosition.all([
      {
        memcmp: {
          offset: 8, // After discriminator
          bytes: organization.toBase58(),
        },
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return accounts.map((acc: any) => ({
      publicKey: acc.publicKey,
      account: acc.account as VestingPosition,
    }))
  } catch (err) {
    console.warn('Failed to fetch positions, returning empty:', err)
    return []
  }
}

/**
 * Fetch positions by beneficiary commitment
 * Note: This requires iterating all positions since commitment is a hash
 */
export async function fetchPositionsByCommitment(
  program: ShadowVestProgram,
  commitment: Uint8Array
): Promise<Array<{ publicKey: PublicKey; account: VestingPosition }>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allPositions = await (program.account as any).vestingPosition.all()
    return allPositions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((acc: any) => {
        const pos = acc.account as VestingPosition
        // Compare byte arrays
        const posCommitment = new Uint8Array(pos.beneficiaryCommitment)
        if (posCommitment.length !== commitment.length) return false
        return posCommitment.every((byte, i) => byte === commitment[i])
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((acc: any) => ({
        publicKey: acc.publicKey,
        account: acc.account as VestingPosition,
      }))
  } catch (err) {
    console.error('Failed to fetch positions by commitment:', err)
    return []
  }
}

// =============================================================================
// Vesting Calculations (Based on Schedule, not Position)
// Note: Actual amounts are encrypted - these calculations are for UI display only
// =============================================================================

/**
 * Calculate vesting progress based on schedule timing
 * Returns 0-100 percentage
 */
export function calculateVestingProgress(
  schedule: VestingSchedule,
  startTimestamp: BN,
  currentTime: number = Math.floor(Date.now() / 1000)
): number {
  const startTime = startTimestamp.toNumber()
  const cliffDuration = schedule.cliffDuration.toNumber()
  const totalDuration = schedule.totalDuration.toNumber()

  // Before cliff - 0%
  if (currentTime < startTime + cliffDuration) {
    return 0
  }

  // After full vesting - 100%
  if (currentTime >= startTime + totalDuration) {
    return 100
  }

  // Linear vesting between cliff and end
  const elapsed = currentTime - startTime
  const progress = (elapsed / totalDuration) * 100

  return Math.min(100, Math.max(0, Math.floor(progress)))
}

// =============================================================================
// Position Stats (for UI display)
// =============================================================================

export interface PositionStats {
  vestingProgress: number
  isFullyVested: boolean
  cliffEndTime: number
  vestingEndTime: number
  // Note: amounts are encrypted - these are placeholders
  totalAmount: BN
  claimedAmount: BN
  claimableAmount: BN
}

/**
 * Get stats for a position (UI display purposes)
 * Note: Actual amounts require MPC decryption
 */
export async function getPositionStats(
  program: ShadowVestProgram,
  position: VestingPosition,
  currentTime: number = Math.floor(Date.now() / 1000)
): Promise<PositionStats> {
  // Fetch schedule for timing info
  const schedule = await fetchSchedule(program, position.schedule)

  const startTime = position.startTimestamp.toNumber()
  const cliffDuration = schedule?.cliffDuration.toNumber() || 0
  const totalDuration = schedule?.totalDuration.toNumber() || 0

  const vestingProgress = schedule
    ? calculateVestingProgress(schedule, position.startTimestamp, currentTime)
    : 0

  return {
    vestingProgress,
    isFullyVested: vestingProgress >= 100,
    cliffEndTime: startTime + cliffDuration,
    vestingEndTime: startTime + totalDuration,
    // Amounts are encrypted - return zero/placeholder values
    // Real values would come from MPC callback or decryption
    totalAmount: new BN(0),
    claimedAmount: new BN(0),
    claimableAmount: new BN(0),
  }
}

// =============================================================================
// Withdrawal
// =============================================================================

/**
 * Withdraw tokens from a processed claim
 */
export async function withdrawTokens(
  program: ShadowVestProgram,
  organization: PublicKey,
  positionId: number,
  nullifier: Uint8Array,
  destination: PublicKey
): Promise<string> {
  const payer = program.provider.publicKey!
  const orgData = await fetchOrganization(program, organization)
  if (!orgData) throw new Error('Organization not found')

  const [claimAuthorization] = findClaimAuthorizationPda(
    organization,
    positionId,
    nullifier
  )
  const [vaultAuthority] = findVaultAuthorityPda(organization)
  const [vault] = findVaultPda(organization)

  return program.methods
    .withdrawCompressed(new BN(positionId), Array.from(nullifier))
    .accounts({
      payer,
      organization,
      claimAuthorization,
      vaultAuthority,
      vault,
      destination,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc()
}
