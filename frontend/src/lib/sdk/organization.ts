/**
 * Organization SDK
 *
 * Functions for creating and managing organizations.
 */

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import {
  findOrganizationPda,
  findSchedulePda,
  findVaultAuthorityPda,
  findVaultPda,
  BN,
} from './program'
import type {
  ShadowVestProgram,
  Organization,
  VestingSchedule,
} from './program'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Hash a name to a 32-byte array using SHA-256
 */
export async function hashName(name: string): Promise<number[]> {
  const encoder = new TextEncoder()
  const data = encoder.encode(name)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
}

/**
 * Get name hash as hex string (for backend API)
 */
export async function getNameHashHex(name: string): Promise<string> {
  const hashArray = await hashName(name)
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// Organization Management
// =============================================================================

export interface CreateOrganizationParams {
  name: string
  tokenMint: PublicKey
  treasury?: PublicKey // Optional - will generate random if not provided
}

export interface CreateOrganizationWithVaultParams {
  name: string
  tokenMint: PublicKey
  treasury?: PublicKey
  initialDeposit?: BN // Optional initial deposit amount
}

/**
 * Create a new organization
 */
export async function createOrganization(
  program: ShadowVestProgram,
  params: CreateOrganizationParams
): Promise<{ signature: string; organization: PublicKey }> {
  const admin = program.provider.publicKey!
  const [organization] = findOrganizationPda(admin)

  // Hash the name to 32-byte array
  const nameHash = await hashName(params.name)

  // Use provided treasury or generate a random one
  const treasury = params.treasury || Keypair.generate().publicKey

  const signature = await program.methods
    .createOrganization(nameHash, treasury, params.tokenMint)
    .accounts({
      admin,
      organization,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  return { signature, organization }
}

/**
 * Create organization with vault initialization and optional deposit in one flow
 * This provides better UX by combining multiple steps into fewer transactions
 */
export async function createOrganizationWithVault(
  program: ShadowVestProgram,
  params: CreateOrganizationWithVaultParams
): Promise<{
  signature: string
  organization: PublicKey
  vault: PublicKey
  depositSignature?: string
}> {
  const admin = program.provider.publicKey!
  const [organization] = findOrganizationPda(admin)
  const [vaultAuthority] = findVaultAuthorityPda(organization)
  const [vault] = findVaultPda(organization)

  // Hash the name to 32-byte array
  const nameHash = await hashName(params.name)

  // Use provided treasury or generate a random one
  const treasury = params.treasury || Keypair.generate().publicKey

  // Step 1: Create organization + Initialize vault in one transaction
  // We use postInstructions to add initializeVault after createOrganization
  const initVaultIx = await program.methods
    .initializeVault()
    .accounts({
      admin,
      organization,
      vaultAuthority,
      vault,
      tokenMint: params.tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction()

  const signature = await program.methods
    .createOrganization(nameHash, treasury, params.tokenMint)
    .accounts({
      admin,
      organization,
      systemProgram: SystemProgram.programId,
    })
    .postInstructions([initVaultIx])
    .rpc()

  // Step 2: Deposit tokens if amount provided (separate tx since we need user's ATA)
  let depositSignature: string | undefined
  if (params.initialDeposit && params.initialDeposit.gtn(0)) {
    const adminTokenAccount = await getAssociatedTokenAddress(
      params.tokenMint,
      admin
    )

    depositSignature = await program.methods
      .depositToVault(params.initialDeposit)
      .accounts({
        admin,
        organization,
        adminTokenAccount,
        vault,
        vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()
  }

  return { signature, organization, vault, depositSignature }
}

/**
 * Fetch organization account data
 */
export async function fetchOrganization(
  program: ShadowVestProgram,
  organization: PublicKey
): Promise<Organization | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = await (program.account as any).organization.fetch(organization)
    return account as Organization
  } catch (err) {
    console.warn('Failed to fetch organization:', organization.toBase58(), err)
    return null
  }
}

/**
 * Fetch organization by admin
 */
export async function fetchOrganizationByAdmin(
  program: ShadowVestProgram,
  admin: PublicKey
): Promise<{ organization: PublicKey; data: Organization } | null> {
  const [organization] = findOrganizationPda(admin)
  const data = await fetchOrganization(program, organization)
  if (!data) return null
  return { organization, data }
}

/**
 * Fetch all organizations (paginated)
 * Uses dataSize filter to only fetch accounts with the current schema (162 bytes)
 * This avoids decode errors from old accounts created with a different schema
 */
export async function fetchAllOrganizations(
  program: ShadowVestProgram,
  limit = 100
): Promise<Array<{ publicKey: PublicKey; account: Organization }>> {
  try {
    // Filter by data size to only get accounts with current schema
    // Old accounts may have 154 bytes (missing compressed_position_count field)
    // Current schema requires 162 bytes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await (program.account as any).organization.all([
      {
        dataSize: 162, // Only fetch accounts with current schema size
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return accounts.slice(0, limit).map((acc: any) => ({
      publicKey: acc.publicKey,
      account: acc.account as Organization,
    }))
  } catch (err) {
    // If .all() fails, return empty array
    console.warn('Failed to fetch all organizations, returning empty:', err)
    return []
  }
}

// =============================================================================
// Vault Management
// =============================================================================

/**
 * Initialize vault for an organization
 */
export async function initializeVault(
  program: ShadowVestProgram,
  organization: PublicKey
): Promise<{ signature: string; vault: PublicKey }> {
  const admin = program.provider.publicKey!
  const orgData = await fetchOrganization(program, organization)
  if (!orgData) throw new Error('Organization not found')

  const [vaultAuthority] = findVaultAuthorityPda(organization)
  const [vault] = findVaultPda(organization)

  const signature = await program.methods
    .initializeVault()
    .accounts({
      admin,
      organization,
      vaultAuthority,
      vault,
      tokenMint: orgData.tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  return { signature, vault }
}

/**
 * Deposit tokens to organization vault
 */
export async function depositToVault(
  program: ShadowVestProgram,
  organization: PublicKey,
  amount: BN
): Promise<string> {
  const admin = program.provider.publicKey!
  const orgData = await fetchOrganization(program, organization)
  if (!orgData) throw new Error('Organization not found')

  const [vaultAuthority] = findVaultAuthorityPda(organization)
  const [vault] = findVaultPda(organization)
  const adminTokenAccount = await getAssociatedTokenAddress(
    orgData.tokenMint,
    admin
  )

  return program.methods
    .depositToVault(amount)
    .accounts({
      admin,
      organization,
      adminTokenAccount,
      vault,
      vaultAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc()
}

// =============================================================================
// Vesting Schedule Management
// =============================================================================

export interface CreateScheduleParams {
  cliffDuration: BN
  totalDuration: BN
  vestingInterval: BN
}

/**
 * Create a new vesting schedule
 */
export async function createVestingSchedule(
  program: ShadowVestProgram,
  organization: PublicKey,
  params: CreateScheduleParams
): Promise<{ signature: string; schedule: PublicKey; scheduleId: number }> {
  const admin = program.provider.publicKey!
  const orgData = await fetchOrganization(program, organization)
  if (!orgData) throw new Error('Organization not found')

  const scheduleId = orgData.scheduleCount.toNumber()
  const [schedule] = findSchedulePda(organization, scheduleId)

  const signature = await program.methods
    .createVestingSchedule(
      params.cliffDuration,
      params.totalDuration,
      params.vestingInterval
    )
    .accounts({
      admin,
      organization,
      schedule,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  return { signature, schedule, scheduleId }
}

/**
 * Fetch vesting schedule account data
 */
export async function fetchSchedule(
  program: ShadowVestProgram,
  schedule: PublicKey
): Promise<VestingSchedule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = await (program.account as any).vestingSchedule.fetch(schedule)
    return account as VestingSchedule
  } catch {
    return null
  }
}

/**
 * Fetch all schedules for an organization
 */
export async function fetchSchedulesByOrganization(
  program: ShadowVestProgram,
  organization: PublicKey
): Promise<Array<{ publicKey: PublicKey; account: VestingSchedule }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = await (program.account as any).vestingSchedule.all([
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
    account: acc.account as VestingSchedule,
  }))
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get organization stats
 */
export interface OrganizationStats {
  scheduleCount: number
  positionCount: number
  compressedPositionCount: number
  vaultBalance: BN | null
}

export async function getOrganizationStats(
  program: ShadowVestProgram,
  organization: PublicKey
): Promise<OrganizationStats | null> {
  const orgData = await fetchOrganization(program, organization)
  if (!orgData) return null

  // Try to fetch vault balance
  let vaultBalance: BN | null = null
  try {
    const [vault] = findVaultPda(organization)
    const vaultAccount = await program.provider.connection.getTokenAccountBalance(vault)
    vaultBalance = new BN(vaultAccount.value.amount)
  } catch {
    // Vault might not be initialized
  }

  return {
    scheduleCount: orgData.scheduleCount.toNumber(),
    positionCount: orgData.positionCount.toNumber(),
    compressedPositionCount: orgData.compressedPositionCount.toNumber(),
    vaultBalance,
  }
}
