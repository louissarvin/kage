/**
 * ShadowVest Program SDK
 *
 * Anchor program client setup for interacting with the ShadowVest contract.
 */

import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import idl from './idl.json'

// Program ID - read from IDL to ensure consistency
export const PROGRAM_ID = new PublicKey(idl.address)

// Re-export useful types
export { BN }
export type { PublicKey }

/**
 * Contract type from IDL (we'll use 'any' for now since types are complex)
 */
export type ShadowVestProgram = Program<Idl>

/**
 * Create an Anchor provider from wallet adapter
 */
export function createProvider(
  connection: Connection,
  wallet: AnchorWallet
): AnchorProvider {
  return new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  })
}

/**
 * Get the ShadowVest program instance
 */
export function getProgram(provider: AnchorProvider): ShadowVestProgram {
  return new Program(idl as Idl, provider)
}

/**
 * Create program instance from connection and wallet
 */
export function createProgram(
  connection: Connection,
  wallet: AnchorWallet
): ShadowVestProgram {
  const provider = createProvider(connection, wallet)
  return getProgram(provider)
}

// =============================================================================
// PDA Derivation Helpers
// =============================================================================

/**
 * Derive Organization PDA
 */
export function findOrganizationPda(admin: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('organization'), admin.toBuffer()],
    PROGRAM_ID
  )
}

/**
 * Derive Vesting Schedule PDA
 */
export function findSchedulePda(
  organization: PublicKey,
  scheduleId: number
): [PublicKey, number] {
  const scheduleIdBuffer = Buffer.alloc(8)
  scheduleIdBuffer.writeBigUInt64LE(BigInt(scheduleId))
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vesting_schedule'), organization.toBuffer(), scheduleIdBuffer],
    PROGRAM_ID
  )
}

/**
 * Derive Vesting Position PDA
 */
export function findPositionPda(
  organization: PublicKey,
  positionId: number
): [PublicKey, number] {
  const positionIdBuffer = Buffer.alloc(8)
  positionIdBuffer.writeBigUInt64LE(BigInt(positionId))
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vesting_position'), organization.toBuffer(), positionIdBuffer],
    PROGRAM_ID
  )
}

/**
 * Derive Vault Authority PDA
 */
export function findVaultAuthorityPda(organization: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), organization.toBuffer()],
    PROGRAM_ID
  )
}

/**
 * Derive Vault PDA
 */
export function findVaultPda(organization: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), organization.toBuffer()],
    PROGRAM_ID
  )
}

/**
 * Derive Stealth Meta PDA
 */
export function findStealthMetaPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stealth_meta'), owner.toBuffer()],
    PROGRAM_ID
  )
}

/**
 * Derive Claim Authorization PDA
 */
export function findClaimAuthorizationPda(
  organization: PublicKey,
  positionId: number,
  nullifier: Uint8Array
): [PublicKey, number] {
  const positionIdBuffer = Buffer.alloc(8)
  positionIdBuffer.writeBigUInt64LE(BigInt(positionId))
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('claim_authorization'),
      organization.toBuffer(),
      positionIdBuffer,
      Buffer.from(nullifier),
    ],
    PROGRAM_ID
  )
}

/**
 * Derive Nullifier PDA (for double-spend prevention)
 */
export function findNullifierPda(
  organization: PublicKey,
  nullifier: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), organization.toBuffer(), Buffer.from(nullifier)],
    PROGRAM_ID
  )
}

// =============================================================================
// Account Types (simplified versions of IDL types)
// =============================================================================

export interface Organization {
  admin: PublicKey
  name: string
  tokenMint: PublicKey
  totalPositions: BN
  totalSchedules: BN
  isActive: boolean
  bump: number
}

export interface VestingSchedule {
  organization: PublicKey
  scheduleId: BN
  name: string
  totalAmount: BN
  startTime: BN
  cliffDuration: BN
  vestingDuration: BN
  isActive: boolean
  bump: number
}

export interface VestingPosition {
  organization: PublicKey
  schedule: PublicKey
  positionId: BN
  beneficiaryCommitment: Uint8Array
  totalAmount: BN
  claimedAmount: BN
  startTime: BN
  cliffDuration: BN
  vestingDuration: BN
  isActive: boolean
  bump: number
}

export interface StealthMeta {
  owner: PublicKey
  spendPubkey: Uint8Array
  viewPubkey: Uint8Array
  isActive: boolean
  bump: number
}

export interface ClaimAuthorization {
  position: PublicKey
  nullifier: Uint8Array
  withdrawalDestination: PublicKey
  claimAmount: BN
  isAuthorized: boolean
  isProcessed: boolean
  isWithdrawn: boolean
  authorizedAt: BN
  bump: number
}
