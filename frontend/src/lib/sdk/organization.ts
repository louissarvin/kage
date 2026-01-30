/**
 * Organization SDK
 *
 * Functions for creating and managing organizations.
 */

import { PublicKey, SystemProgram } from '@solana/web3.js'
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
// Organization Management
// =============================================================================

export interface CreateOrganizationParams {
  name: string
  tokenMint: PublicKey
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

  const signature = await program.methods
    .createOrganization(params.name)
    .accounts({
      admin,
      organization,
      tokenMint: params.tokenMint,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  return { signature, organization }
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
  } catch {
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
 */
export async function fetchAllOrganizations(
  program: ShadowVestProgram,
  limit = 100
): Promise<Array<{ publicKey: PublicKey; account: Organization }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = await (program.account as any).organization.all()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return accounts.slice(0, limit).map((acc: any) => ({
    publicKey: acc.publicKey,
    account: acc.account as Organization,
  }))
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
  name: string
  totalAmount: BN
  startTime: BN
  cliffDuration: BN
  vestingDuration: BN
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

  const scheduleId = orgData.totalSchedules.toNumber()
  const [schedule] = findSchedulePda(organization, scheduleId)

  const signature = await program.methods
    .createVestingSchedule(
      params.name,
      params.totalAmount,
      params.startTime,
      params.cliffDuration,
      params.vestingDuration
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
  totalSchedules: number
  totalPositions: number
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
    totalSchedules: orgData.totalSchedules.toNumber(),
    totalPositions: orgData.totalPositions.toNumber(),
    vaultBalance,
  }
}
