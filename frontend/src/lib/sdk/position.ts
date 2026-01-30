/**
 * Position SDK
 *
 * Functions for creating and managing vesting positions.
 */

import { PublicKey, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  findPositionPda,
  findSchedulePda,
  findVaultAuthorityPda,
  findVaultPda,
  findClaimAuthorizationPda,
  BN,
} from './program'
import type {
  ShadowVestProgram,
  VestingPosition,
} from './program'
import { fetchOrganization } from './organization'

// =============================================================================
// Position Management
// =============================================================================

export interface CreatePositionParams {
  scheduleId: number
  beneficiaryCommitment: Uint8Array // 32-byte commitment hash
  totalAmount: BN
  startTime: BN
  cliffDuration: BN
  vestingDuration: BN
}

/**
 * Create a new vesting position
 */
export async function createVestingPosition(
  program: ShadowVestProgram,
  organization: PublicKey,
  params: CreatePositionParams
): Promise<{ signature: string; position: PublicKey; positionId: number }> {
  const admin = program.provider.publicKey!
  const orgData = await fetchOrganization(program, organization)
  if (!orgData) throw new Error('Organization not found')

  const positionId = orgData.totalPositions.toNumber()
  const [position] = findPositionPda(organization, positionId)
  const [schedule] = findSchedulePda(organization, params.scheduleId)

  const signature = await program.methods
    .createVestingPosition(
      Array.from(params.beneficiaryCommitment),
      params.totalAmount,
      params.startTime,
      params.cliffDuration,
      params.vestingDuration
    )
    .accounts({
      admin,
      organization,
      schedule,
      position,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  return { signature, position, positionId }
}

/**
 * Create a stealth vesting position (privacy-preserving)
 */
export async function createStealthVestingPosition(
  program: ShadowVestProgram,
  organization: PublicKey,
  params: CreatePositionParams & {
    stealthAddress: PublicKey
    ephemeralPubkey: Uint8Array
  }
): Promise<{ signature: string; position: PublicKey; positionId: number }> {
  const admin = program.provider.publicKey!
  const orgData = await fetchOrganization(program, organization)
  if (!orgData) throw new Error('Organization not found')

  const positionId = orgData.totalPositions.toNumber()
  const [position] = findPositionPda(organization, positionId)
  const [schedule] = findSchedulePda(organization, params.scheduleId)

  const signature = await program.methods
    .createStealthVestingPosition(
      Array.from(params.beneficiaryCommitment),
      params.totalAmount,
      params.startTime,
      params.cliffDuration,
      params.vestingDuration,
      Array.from(params.ephemeralPubkey)
    )
    .accounts({
      admin,
      organization,
      schedule,
      position,
      stealthAddress: params.stealthAddress,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  return { signature, position, positionId }
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
}

/**
 * Fetch positions by beneficiary commitment
 * Note: This requires iterating all positions since commitment is a hash
 */
export async function fetchPositionsByCommitment(
  program: ShadowVestProgram,
  commitment: Uint8Array
): Promise<Array<{ publicKey: PublicKey; account: VestingPosition }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPositions = await (program.account as any).vestingPosition.all()
  return allPositions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((acc: any) => {
      const pos = acc.account as VestingPosition
      return Buffer.from(pos.beneficiaryCommitment).equals(Buffer.from(commitment))
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((acc: any) => ({
      publicKey: acc.publicKey,
      account: acc.account as VestingPosition,
    }))
}

// =============================================================================
// Vesting Calculations
// =============================================================================

/**
 * Calculate vested amount for a position at a given time
 */
export function calculateVestedAmount(
  position: VestingPosition,
  currentTime: number
): BN {
  const startTime = position.startTime.toNumber()
  const cliffDuration = position.cliffDuration.toNumber()
  const vestingDuration = position.vestingDuration.toNumber()
  const totalAmount = position.totalAmount

  // Before cliff - nothing vested
  if (currentTime < startTime + cliffDuration) {
    return new BN(0)
  }

  // After full vesting - everything vested
  if (currentTime >= startTime + vestingDuration) {
    return totalAmount
  }

  // Linear vesting between cliff and end
  const elapsedAfterCliff = currentTime - (startTime + cliffDuration)
  const vestingAfterCliff = vestingDuration - cliffDuration

  if (vestingAfterCliff <= 0) {
    return totalAmount
  }

  // Calculate proportional amount
  const vestedAmount = totalAmount
    .mul(new BN(elapsedAfterCliff))
    .div(new BN(vestingAfterCliff))

  return vestedAmount
}

/**
 * Calculate claimable amount (vested - already claimed)
 */
export function calculateClaimableAmount(
  position: VestingPosition,
  currentTime: number
): BN {
  const vested = calculateVestedAmount(position, currentTime)
  const claimed = position.claimedAmount

  if (vested.lte(claimed)) {
    return new BN(0)
  }

  return vested.sub(claimed)
}

/**
 * Get position vesting progress (0-100%)
 */
export function getVestingProgress(
  position: VestingPosition,
  currentTime: number
): number {
  const vested = calculateVestedAmount(position, currentTime)
  const total = position.totalAmount

  if (total.isZero()) return 100

  return vested.mul(new BN(100)).div(total).toNumber()
}

// =============================================================================
// Position Stats
// =============================================================================

export interface PositionStats {
  totalAmount: BN
  claimedAmount: BN
  vestedAmount: BN
  claimableAmount: BN
  vestingProgress: number
  isFullyVested: boolean
  isFullyClaimed: boolean
  cliffEndTime: number
  vestingEndTime: number
}

/**
 * Get comprehensive stats for a position
 */
export function getPositionStats(
  position: VestingPosition,
  currentTime: number = Math.floor(Date.now() / 1000)
): PositionStats {
  const startTime = position.startTime.toNumber()
  const cliffDuration = position.cliffDuration.toNumber()
  const vestingDuration = position.vestingDuration.toNumber()

  const vestedAmount = calculateVestedAmount(position, currentTime)
  const claimableAmount = calculateClaimableAmount(position, currentTime)
  const vestingProgress = getVestingProgress(position, currentTime)

  return {
    totalAmount: position.totalAmount,
    claimedAmount: position.claimedAmount,
    vestedAmount,
    claimableAmount,
    vestingProgress,
    isFullyVested: vestingProgress >= 100,
    isFullyClaimed: position.claimedAmount.gte(position.totalAmount),
    cliffEndTime: startTime + cliffDuration,
    vestingEndTime: startTime + vestingDuration,
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
