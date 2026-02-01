/**
 * Service Organization Module
 *
 * The backend service creates and manages its OWN organization to handle claim processing.
 * This is necessary because:
 *
 * 1. Creating a VestingPosition requires the organization admin's signature
 * 2. The SERVICE_KEYPAIR is NOT the admin of user-created organizations
 * 3. Employees cannot create scratch positions (they're not admins)
 *
 * Solution:
 * - On startup, create a "service organization" where SERVICE_KEYPAIR is the admin
 * - Use this organization for all scratch positions during claim processing
 * - The scratch position is just a temporary MPC callback target
 * - It doesn't affect the actual vesting amounts (those come from compressed positions)
 */

import {
  Connection,
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js'
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token'
import BN from 'bn.js'
import { randomBytes, createHash } from 'crypto'
import {
  getCompDefAccOffset,
  getArciumProgramId,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
  x25519,
  RescueCipher,
  deserializeLE,
} from '@arcium-hq/client'
import { config } from '../config/index.js'
import {
  getConnection,
  getProgram,
  createProvider,
  findOrganizationPda,
  findSchedulePda,
  findPositionPda,
  findSignPda,
  findVaultPda,
  findVaultAuthorityPda,
  encryptAmount,
} from './solana.js'
import { getServiceKeypair } from './serviceKeypair.js'
import bs58 from 'bs58'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load IDL
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const idlPath = join(__dirname, '../../idl/contract.json')
const idlJson = JSON.parse(readFileSync(idlPath, 'utf-8'))

// Arcium configuration
const ARCIUM_CLUSTER_OFFSET = config.arciumClusterOffset

// =============================================================================
// Service Organization State
// =============================================================================

interface ServiceOrgState {
  initialized: boolean
  organizationPda: PublicKey | null
  schedulePda: PublicKey | null
  vaultPda: PublicKey | null
  vaultAuthorityPda: PublicKey | null
  scheduleIndex: number
}

const state: ServiceOrgState = {
  initialized: false,
  organizationPda: null,
  schedulePda: null,
  vaultPda: null,
  vaultAuthorityPda: null,
  scheduleIndex: 0,
}

// =============================================================================
// Exported Getters
// =============================================================================

/**
 * Get the service organization PDA
 * Throws if not initialized
 */
export function getServiceOrganization(): PublicKey {
  if (!state.organizationPda) {
    throw new Error('Service organization not initialized. Call initializeServiceOrganization() first.')
  }
  return state.organizationPda
}

/**
 * Get the service organization's schedule PDA
 * Throws if not initialized
 */
export function getServiceSchedule(): PublicKey {
  if (!state.schedulePda) {
    throw new Error('Service organization not initialized. Call initializeServiceOrganization() first.')
  }
  return state.schedulePda
}

/**
 * Get the service organization's vault PDA
 */
export function getServiceVault(): PublicKey {
  if (!state.vaultPda) {
    throw new Error('Service organization not initialized. Call initializeServiceOrganization() first.')
  }
  return state.vaultPda
}

/**
 * Get the service organization's vault authority PDA
 */
export function getServiceVaultAuthority(): PublicKey {
  if (!state.vaultAuthorityPda) {
    throw new Error('Service organization not initialized. Call initializeServiceOrganization() first.')
  }
  return state.vaultAuthorityPda
}

/**
 * Check if service organization is initialized
 */
export function isServiceOrgInitialized(): boolean {
  return state.initialized
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the service organization on startup
 *
 * This creates an organization where SERVICE_KEYPAIR is the admin.
 * The service can then create scratch positions for claim processing.
 *
 * @param tokenMint - The token mint for the vault (must match user orgs)
 */
export async function initializeServiceOrganization(tokenMint: PublicKey): Promise<void> {
  if (state.initialized) {
    console.log('[ServiceOrg] Already initialized')
    return
  }

  console.log('[ServiceOrg] Initializing service organization...')

  const serviceKp = getServiceKeypair()
  const provider = createProvider(serviceKp)
  const program = getProgram(provider)
  const connection = getConnection()
  const programId = new PublicKey(config.shadowvestProgramId)

  // Derive organization PDA from service keypair
  const [orgPda] = findOrganizationPda(serviceKp.publicKey)
  console.log('[ServiceOrg] Organization PDA:', orgPda.toBase58())
  console.log('[ServiceOrg] Admin (service):', serviceKp.publicKey.toBase58())

  // Check if organization already exists on-chain
  try {
    const orgAccount = await (program.account as any).organization.fetch(orgPda)
    console.log('[ServiceOrg] Organization already exists on-chain')
    console.log('[ServiceOrg] Position count:', orgAccount.positionCount.toNumber())
    console.log('[ServiceOrg] Schedule count:', orgAccount.scheduleCount.toNumber())

    // Derive schedule PDA
    const scheduleIndex = 0
    const [schedulePda] = findSchedulePda(orgPda, scheduleIndex)
    const [vaultPda] = findVaultPda(orgPda)
    const [vaultAuthorityPda] = findVaultAuthorityPda(orgPda)

    state.organizationPda = orgPda
    state.schedulePda = schedulePda
    state.vaultPda = vaultPda
    state.vaultAuthorityPda = vaultAuthorityPda
    state.scheduleIndex = scheduleIndex
    state.initialized = true

    console.log('[ServiceOrg] Initialized from existing on-chain data')
    return
  } catch (err) {
    console.log('[ServiceOrg] Organization fetch failed, will try to create...')
    console.log('[ServiceOrg] Fetch error:', err instanceof Error ? err.message : err)
  }

  // Also check if account exists but couldn't be deserialized (corrupted/different format)
  const accountInfo = await connection.getAccountInfo(orgPda)
  if (accountInfo !== null) {
    console.log('[ServiceOrg] Organization account exists on-chain (possibly with different data)')
    console.log('[ServiceOrg] Account size:', accountInfo.data.length)
    console.log('[ServiceOrg] Expected size: 162 bytes')

    // Check if account size matches expected
    if (accountInfo.data.length < 162) {
      console.error('[ServiceOrg] ERROR: Account size mismatch!')
      console.error('[ServiceOrg] The service organization was created with an older contract version.')
      console.error('[ServiceOrg] Solution: Use a different SERVICE_KEYPAIR in .env to create a new organization.')
      console.error('[ServiceOrg] Current SERVICE_KEYPAIR derives org PDA:', orgPda.toBase58())
      throw new Error(
        `Service organization account has incompatible size (${accountInfo.data.length} bytes, expected 162). ` +
        `Please use a different SERVICE_KEYPAIR to create a new service organization.`
      )
    }

    // Account exists with correct size, set up state
    const scheduleIndex = 0
    const [schedulePda] = findSchedulePda(orgPda, scheduleIndex)
    const [vaultPda] = findVaultPda(orgPda)
    const [vaultAuthorityPda] = findVaultAuthorityPda(orgPda)

    state.organizationPda = orgPda
    state.schedulePda = schedulePda
    state.vaultPda = vaultPda
    state.vaultAuthorityPda = vaultAuthorityPda
    state.scheduleIndex = scheduleIndex
    state.initialized = true

    console.log('[ServiceOrg] Initialized from existing account')
    return
  }

  console.log('[ServiceOrg] Organization does not exist, creating...')

  // Create the organization on-chain
  try {
    // Hash a unique name for the service organization
    const nameHash = createHash('sha256')
      .update('shadowvest-claim-service')
      .digest()

    // Derive vault PDAs (for state tracking, not used in createOrganization)
    const [vaultPda] = findVaultPda(orgPda)
    const [vaultAuthorityPda] = findVaultAuthorityPda(orgPda)

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })

    console.log('[ServiceOrg] Creating organization...')
    console.log('[ServiceOrg] Token Mint:', tokenMint.toBase58())
    console.log('[ServiceOrg] Admin:', serviceKp.publicKey.toBase58())

    // createOrganization takes: name_hash, treasury, token_mint as ARGUMENTS
    // Accounts: admin, organization, system_program
    const createOrgTx = await (program.methods as any)
      .createOrganization(
        Array.from(nameHash),           // name_hash: [u8; 32]
        serviceKp.publicKey,            // treasury: Pubkey (use admin as treasury)
        tokenMint                       // token_mint: Pubkey
      )
      .accounts({
        admin: serviceKp.publicKey,
        organization: orgPda,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([computeIx, priorityFeeIx])
      .signers([serviceKp])
      .rpc({ commitment: 'confirmed' })

    console.log('[ServiceOrg] Organization created:', createOrgTx)

    // Create a default vesting schedule for scratch positions
    // Use minimal duration since scratch positions are just MPC callback targets
    const scheduleIndex = 0
    const [schedulePda] = findSchedulePda(orgPda, scheduleIndex)

    console.log('[ServiceOrg] Creating vesting schedule...')

    // createVestingSchedule accounts: admin, organization, schedule, system_program
    const createScheduleTx = await (program.methods as any)
      .createVestingSchedule(
        new BN(0), // cliff duration (0 for scratch positions)
        new BN(1), // total duration (minimal, 1 second)
        new BN(1)  // vesting interval (1 second)
      )
      .accounts({
        admin: serviceKp.publicKey,
        organization: orgPda,
        schedule: schedulePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([serviceKp])
      .rpc({ commitment: 'confirmed' })

    console.log('[ServiceOrg] Schedule created:', createScheduleTx)

    // Update state
    state.organizationPda = orgPda
    state.schedulePda = schedulePda
    state.vaultPda = vaultPda
    state.vaultAuthorityPda = vaultAuthorityPda
    state.scheduleIndex = scheduleIndex
    state.initialized = true

    console.log('[ServiceOrg] Service organization initialized successfully')
  } catch (err) {
    console.error('[ServiceOrg] Failed to create service organization:', err)
    throw err
  }
}

// =============================================================================
// Scratch Position Creation
// =============================================================================

export interface CreateScratchPositionResult {
  positionPda: PublicKey
  positionId: number
  txSignature: string
}

/**
 * Create a scratch position in the service organization
 *
 * This position is used as an MPC callback target for claim processing.
 * It doesn't hold actual vesting amounts - those come from compressed positions.
 *
 * @param beneficiaryCommitment - 32-byte beneficiary commitment (for signature verification)
 */
export async function createScratchPosition(
  beneficiaryCommitment: Buffer
): Promise<CreateScratchPositionResult> {
  if (!state.initialized) {
    throw new Error('Service organization not initialized')
  }

  const serviceKp = getServiceKeypair()
  const provider = createProvider(serviceKp)
  const program = getProgram(provider)
  const programId = new PublicKey(config.shadowvestProgramId)

  // Get current position count
  const orgAccount = await (program.account as any).organization.fetch(state.organizationPda!)
  const positionId = orgAccount.positionCount.toNumber()

  // Derive position PDA
  const [positionPda] = findPositionPda(state.organizationPda!, positionId)
  const [signPda] = findSignPda()

  console.log('[ServiceOrg] Creating scratch position...')
  console.log('[ServiceOrg] Position ID:', positionId)
  console.log('[ServiceOrg] Position PDA:', positionPda.toBase58())

  // Encrypt zero amount (scratch positions don't have real amounts)
  const encrypted = await encryptAmount(provider, BigInt(0))

  // Generate computation offset
  const computationOffsetBytes = randomBytes(8)
  const computationOffset = new BN(computationOffsetBytes)

  // Get cluster account
  const clusterAccount = getClusterAccAddress(ARCIUM_CLUSTER_OFFSET)

  // Build Arcium accounts
  const accounts = {
    payer: serviceKp.publicKey,
    admin: serviceKp.publicKey,
    organization: state.organizationPda!,
    schedule: state.schedulePda!,
    position: positionPda,
    signPdaAccount: signPda,
    mxeAccount: getMXEAccAddress(programId),
    mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
    executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
    computationAccount: getComputationAccAddress(ARCIUM_CLUSTER_OFFSET, computationOffset),
    compDefAccount: getCompDefAccAddress(
      programId,
      Buffer.from(getCompDefAccOffset('init_position')).readUInt32LE()
    ),
    clusterAccount,
    poolAccount: getFeePoolAccAddress(),
    clockAccount: getClockAccAddress(),
    systemProgram: SystemProgram.programId,
    arciumProgram: getArciumProgramId(),
  }

  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })

  // Create the position
  const signature = await (program.methods as any)
    .createVestingPosition(
      computationOffset,
      Array.from(beneficiaryCommitment) as any,
      Array.from(encrypted.ciphertext) as any,
      Array.from(encrypted.publicKey) as any,
      encrypted.nonce
    )
    .accountsPartial(accounts)
    .preInstructions([computeIx, priorityFeeIx])
    .signers([serviceKp])
    .rpc({ commitment: 'confirmed' })

  console.log('[ServiceOrg] Scratch position created:', signature)

  return {
    positionPda,
    positionId,
    txSignature: signature,
  }
}

/**
 * Get the next position ID for the service organization
 */
export async function getNextPositionId(): Promise<number> {
  if (!state.initialized) {
    throw new Error('Service organization not initialized')
  }

  const serviceKp = getServiceKeypair()
  const provider = createProvider(serviceKp)
  const program = getProgram(provider)

  const orgAccount = await (program.account as any).organization.fetch(state.organizationPda!)
  return orgAccount.positionCount.toNumber()
}
