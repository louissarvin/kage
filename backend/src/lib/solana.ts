/**
 * Solana & Arcium MPC Service
 *
 * Handles on-chain interactions with ShadowVest contract using Arcium MPC.
 * This runs in Node.js backend where @arcium-hq/client works properly.
 */

import { Connection, PublicKey, Keypair, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js'
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import BN from 'bn.js'
import { createHash, randomBytes } from 'crypto'
import {
  getCompDefAccOffset,
  getArciumProgramId,
  RescueCipher,
  deserializeLE,
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
} from '@arcium-hq/client'
import { config } from '../config/index.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load IDL
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const idlPath = join(__dirname, '../../idl/contract.json')
const idlJson = JSON.parse(readFileSync(idlPath, 'utf-8'))

// Arcium devnet configuration
const ARCIUM_CLUSTER_OFFSET = parseInt(process.env.ARCIUM_CLUSTER_OFFSET || '456', 10)

// Program type from IDL
type ShadowVestProgram = Program<typeof idlJson>

// =============================================================================
// Connection & Provider Setup
// =============================================================================

let connection: Connection | null = null
let provider: AnchorProvider | null = null
let program: ShadowVestProgram | null = null

/**
 * Get Solana connection (singleton)
 */
export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.solanaRpcUrl, 'confirmed')
  }
  return connection
}

/**
 * Create Anchor provider with a keypair
 * For backend operations, we use a service wallet that pays for transactions
 */
export function createProvider(keypair: Keypair): AnchorProvider {
  const conn = getConnection()
  const wallet = new Wallet(keypair)
  return new AnchorProvider(conn, wallet, { commitment: 'confirmed' })
}

/**
 * Get ShadowVest program instance
 */
export function getProgram(prov: AnchorProvider): ShadowVestProgram {
  const programId = new PublicKey(config.shadowvestProgramId)
  return new Program(idlJson as any, prov) as unknown as ShadowVestProgram
}

// =============================================================================
// PDA Derivation
// =============================================================================

export function findOrganizationPda(admin: PublicKey): [PublicKey, number] {
  const programId = new PublicKey(config.shadowvestProgramId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('organization'), admin.toBuffer()],
    programId
  )
}

export function findSchedulePda(organization: PublicKey, scheduleId: number): [PublicKey, number] {
  const programId = new PublicKey(config.shadowvestProgramId)
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('vesting_schedule'),
      organization.toBuffer(),
      new BN(scheduleId).toArrayLike(Buffer, 'le', 8),
    ],
    programId
  )
}

export function findPositionPda(organization: PublicKey, positionId: number): [PublicKey, number] {
  const programId = new PublicKey(config.shadowvestProgramId)
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('vesting_position'),
      organization.toBuffer(),
      new BN(positionId).toArrayLike(Buffer, 'le', 8),
    ],
    programId
  )
}

export function findSignPda(): [PublicKey, number] {
  const programId = new PublicKey(config.shadowvestProgramId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ArciumSignerAccount')],
    programId
  )
}

// =============================================================================
// Arcium MPC Encryption
// =============================================================================

interface EncryptionResult {
  ciphertext: number[]
  publicKey: Uint8Array
  nonce: BN
}

/**
 * Encrypt amount using Arcium MPC (x25519 + RescueCipher)
 */
export async function encryptAmount(
  prov: AnchorProvider,
  amount: bigint
): Promise<EncryptionResult> {
  const programId = new PublicKey(config.shadowvestProgramId)

  // Get MXE public key for encryption
  const mxePublicKey = await getMXEPublicKey(prov, programId)
  if (!mxePublicKey) {
    throw new Error('Failed to get MXE public key - Arcium MPC may not be initialized')
  }

  // Setup x25519 encryption
  const privateKey = x25519.utils.randomSecretKey()
  const publicKey = x25519.getPublicKey(privateKey)
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey)
  const cipher = new RescueCipher(sharedSecret)

  // Encrypt the amount
  const nonce = randomBytes(16)
  const ciphertext = cipher.encrypt([amount], nonce)
  const nonceAsBN = new BN(deserializeLE(nonce).toString())

  return {
    ciphertext: ciphertext[0],
    publicKey,
    nonce: nonceAsBN,
  }
}

/**
 * Create beneficiary commitment from meta-address
 */
export function createBeneficiaryCommitment(
  metaSpendPub: string,
  metaViewPub: string
): Buffer {
  return createHash('sha256').update(metaSpendPub + metaViewPub).digest()
}

// =============================================================================
// Position Creation (On-Chain with Arcium MPC)
// =============================================================================

export interface CreatePositionOnChainParams {
  adminKeypair: Keypair
  organizationPubkey: string
  scheduleIndex: number
  metaSpendPub: string
  metaViewPub: string
  amount: string // String to handle large numbers
}

export interface CreatePositionOnChainResult {
  signature: string
  positionId: number
  positionPubkey: string
}

/**
 * Create a vesting position on-chain with Arcium MPC encryption
 */
export async function createPositionOnChain(
  params: CreatePositionOnChainParams
): Promise<CreatePositionOnChainResult> {
  const { adminKeypair, organizationPubkey, scheduleIndex, metaSpendPub, metaViewPub, amount } = params
  const programId = new PublicKey(config.shadowvestProgramId)

  // Create provider and program
  const prov = createProvider(adminKeypair)
  const prog = getProgram(prov)

  const organization = new PublicKey(organizationPubkey)

  // Fetch organization to get current position count
  const orgAccount = await (prog.account as any).organization.fetch(organization)
  const positionId = orgAccount.positionCount.toNumber()

  // Derive PDAs
  const [position] = findPositionPda(organization, positionId)
  const [schedule] = findSchedulePda(organization, scheduleIndex)
  const [signPda] = findSignPda()

  // Create beneficiary commitment
  const beneficiaryCommitment = createBeneficiaryCommitment(metaSpendPub, metaViewPub)

  // Encrypt amount using Arcium MPC
  const amountBigInt = BigInt(amount)
  const encrypted = await encryptAmount(prov, amountBigInt)

  // Generate computation offset
  const computationOffsetBytes = randomBytes(8)
  const computationOffset = new BN(computationOffsetBytes)

  // Get Arcium cluster account
  const clusterAccount = getClusterAccAddress(ARCIUM_CLUSTER_OFFSET)

  // Build all Arcium accounts
  const accounts = {
    payer: adminKeypair.publicKey,
    admin: adminKeypair.publicKey,
    organization,
    schedule,
    position,
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

  // Add compute budget instructions for Arcium MPC
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  })
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000,
  })

  console.log('Creating position on-chain with Arcium MPC...')
  console.log('Organization:', organization.toBase58())
  console.log('Position PDA:', position.toBase58())
  console.log('Schedule PDA:', schedule.toBase58())
  console.log('Amount:', amount)

  // Execute transaction
  const signature = await prog.methods
    .createVestingPosition(
      computationOffset,
      Array.from(beneficiaryCommitment) as number[],
      Array.from(encrypted.ciphertext) as number[],
      Array.from(encrypted.publicKey) as number[],
      encrypted.nonce
    )
    .accountsPartial(accounts)
    .preInstructions([modifyComputeUnits, addPriorityFee])
    .signers([adminKeypair])
    .rpc({ commitment: 'confirmed' })

  console.log('Position created! Signature:', signature)

  return {
    signature,
    positionId,
    positionPubkey: position.toBase58(),
  }
}

// =============================================================================
// Fetch On-Chain Data
// =============================================================================

/**
 * Fetch organization data from chain
 */
export async function fetchOrganization(organizationPubkey: string): Promise<any> {
  const conn = getConnection()
  const programId = new PublicKey(config.shadowvestProgramId)

  // Create a dummy provider for read-only operations
  const dummyKeypair = Keypair.generate()
  const prov = createProvider(dummyKeypair)
  const prog = getProgram(prov)

  try {
    const organization = new PublicKey(organizationPubkey)
    return await (prog.account as any).organization.fetch(organization)
  } catch {
    return null
  }
}

/**
 * Fetch schedule data from chain
 */
export async function fetchSchedule(organizationPubkey: string, scheduleIndex: number): Promise<any> {
  const conn = getConnection()

  // Create a dummy provider for read-only operations
  const dummyKeypair = Keypair.generate()
  const prov = createProvider(dummyKeypair)
  const prog = getProgram(prov)

  try {
    const organization = new PublicKey(organizationPubkey)
    const [schedule] = findSchedulePda(organization, scheduleIndex)
    return await (prog.account as any).vestingSchedule.fetch(schedule)
  } catch {
    return null
  }
}

/**
 * Fetch position data from chain
 */
export async function fetchPosition(organizationPubkey: string, positionId: number): Promise<any> {
  // Create a dummy provider for read-only operations
  const dummyKeypair = Keypair.generate()
  const prov = createProvider(dummyKeypair)
  const prog = getProgram(prov)

  try {
    const organization = new PublicKey(organizationPubkey)
    const [position] = findPositionPda(organization, positionId)
    return await (prog.account as any).vestingPosition.fetch(position)
  } catch {
    return null
  }
}

// =============================================================================
// Vesting Calculations
// =============================================================================

export interface VestingProgressInfo {
  positionId: number
  startTimestamp: number
  cliffEndTime: number
  vestingEndTime: number
  currentTime: number
  vestingProgress: number // 0-100
  vestingNumerator: number // 0-1000000 (precision multiplier)
  isInCliff: boolean
  isFullyVested: boolean
  status: 'cliff' | 'vesting' | 'vested'
  timeUntilCliff: number // seconds, 0 if past cliff
  timeUntilFullyVested: number // seconds, 0 if fully vested
}

const PRECISION = 1_000_000

/**
 * Calculate vesting progress from on-chain data
 */
export function calculateVestingProgress(
  position: any,
  schedule: any,
  currentTime?: number
): VestingProgressInfo {
  const now = currentTime ?? Math.floor(Date.now() / 1000)
  const startTime = position.startTimestamp.toNumber()
  const cliffDuration = schedule.cliffDuration.toNumber()
  const totalDuration = schedule.totalDuration.toNumber()
  const vestingInterval = schedule.vestingInterval.toNumber()

  const cliffEndTime = startTime + cliffDuration
  const vestingEndTime = startTime + totalDuration

  // Calculate vesting numerator (same logic as on-chain)
  let vestingNumerator: number
  let status: 'cliff' | 'vesting' | 'vested'
  let isInCliff = false
  let isFullyVested = false

  if (now < cliffEndTime) {
    vestingNumerator = 0
    status = 'cliff'
    isInCliff = true
  } else if (now >= vestingEndTime) {
    vestingNumerator = PRECISION
    status = 'vested'
    isFullyVested = true
  } else {
    const elapsed = now - cliffEndTime
    const intervals = Math.floor(elapsed / vestingInterval)
    const vestedSeconds = intervals * vestingInterval
    const vestingDuration = totalDuration - cliffDuration
    vestingNumerator = vestingDuration > 0
      ? Math.floor((vestedSeconds * PRECISION) / vestingDuration)
      : PRECISION
    status = 'vesting'
  }

  const vestingProgress = Math.floor((vestingNumerator * 100) / PRECISION)
  const timeUntilCliff = isInCliff ? cliffEndTime - now : 0
  const timeUntilFullyVested = isFullyVested ? 0 : Math.max(0, vestingEndTime - now)

  return {
    positionId: position.positionId.toNumber(),
    startTimestamp: startTime,
    cliffEndTime,
    vestingEndTime,
    currentTime: now,
    vestingProgress,
    vestingNumerator,
    isInCliff,
    isFullyVested,
    status,
    timeUntilCliff,
    timeUntilFullyVested,
  }
}

// =============================================================================
// Claim Authorization PDAs
// =============================================================================

export function findClaimAuthorizationPda(
  organization: PublicKey,
  positionId: number,
  nullifier: Buffer
): [PublicKey, number] {
  const programId = new PublicKey(config.shadowvestProgramId)
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('claim_auth'),
      organization.toBuffer(),
      new BN(positionId).toArrayLike(Buffer, 'le', 8),
      nullifier,
    ],
    programId
  )
}

export function findNullifierPda(
  organization: PublicKey,
  nullifier: Buffer
): [PublicKey, number] {
  const programId = new PublicKey(config.shadowvestProgramId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), organization.toBuffer(), nullifier],
    programId
  )
}

export function findVaultAuthorityPda(organization: PublicKey): [PublicKey, number] {
  const programId = new PublicKey(config.shadowvestProgramId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), organization.toBuffer()],
    programId
  )
}

export function findVaultPda(organization: PublicKey): [PublicKey, number] {
  const programId = new PublicKey(config.shadowvestProgramId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), organization.toBuffer()],
    programId
  )
}

// =============================================================================
// Claim MPC Preparation
// =============================================================================

export interface PrepareClaimResult {
  // PDAs
  positionPda: string
  schedulePda: string
  claimAuthorizationPda: string
  nullifierPda: string
  signPda: string
  vaultPda: string
  vaultAuthorityPda: string

  // Vesting info
  vestingProgress: VestingProgressInfo

  // Encrypted data for queue_process_claim
  encryptedTotalAmount: number[]
  encryptedClaimedAmount: number[]
  encryptedVestingNumerator: number[]
  encryptedClaimAmount: number[]
  clientPubkey: number[]
  nonce: string
  computationOffset: string

  // Arcium accounts
  arciumAccounts: {
    mxeAccount: string
    mempoolAccount: string
    executingPool: string
    computationAccount: string
    compDefAccount: string
    clusterAccount: string
    poolAccount: string
    clockAccount: string
    arciumProgram: string
  }

  programId: string
}

/**
 * Prepare data for claim process (MPC encryption for queue_process_claim)
 * This prepares the encrypted values that will be sent to Arcium MPC
 */
export async function prepareClaimData(
  organizationPubkey: string,
  positionId: number,
  claimAmount: bigint, // Amount user wants to claim
  nullifier: Buffer
): Promise<PrepareClaimResult> {
  const programId = new PublicKey(config.shadowvestProgramId)
  const organization = new PublicKey(organizationPubkey)

  // Derive PDAs
  const [positionPda] = findPositionPda(organization, positionId)
  const [claimAuthorizationPda] = findClaimAuthorizationPda(organization, positionId, nullifier)
  const [nullifierPda] = findNullifierPda(organization, nullifier)
  const [signPda] = findSignPda()
  const [vaultPda] = findVaultPda(organization)
  const [vaultAuthorityPda] = findVaultAuthorityPda(organization)

  // Fetch position and schedule data
  const position = await fetchPosition(organizationPubkey, positionId)
  if (!position) {
    throw new Error('Position not found on-chain')
  }

  const scheduleId = position.schedule
  // Get schedule index from position's schedule pubkey
  const orgData = await fetchOrganization(organizationPubkey)
  if (!orgData) {
    throw new Error('Organization not found on-chain')
  }

  // Find schedule by iterating (since we have the schedule pubkey)
  let schedule = null
  for (let i = 0; i < orgData.scheduleCount.toNumber(); i++) {
    const [schedulePda] = findSchedulePda(organization, i)
    if (schedulePda.equals(position.schedule)) {
      schedule = await fetchSchedule(organizationPubkey, i)
      break
    }
  }

  if (!schedule) {
    throw new Error('Schedule not found on-chain')
  }

  // Calculate vesting progress
  const vestingProgress = calculateVestingProgress(position, schedule)

  // Create dummy provider for encryption
  const dummyKeypair = Keypair.generate()
  const prov = createProvider(dummyKeypair)

  // Encrypt values for MPC
  // Note: In production, totalAmount and claimedAmount come from the encrypted position data
  // For MVP, we'll encrypt placeholder values - the MPC circuit handles the actual calculation
  const encTotalAmount = await encryptAmount(prov, BigInt(0)) // Encrypted on-chain
  const encClaimedAmount = await encryptAmount(prov, BigInt(0)) // Encrypted on-chain
  const encVestingNumerator = await encryptAmount(prov, BigInt(vestingProgress.vestingNumerator))
  const encClaimAmount = await encryptAmount(prov, claimAmount)

  // Generate computation offset
  const computationOffsetBytes = randomBytes(8)
  const computationOffset = new BN(computationOffsetBytes)

  // Build Arcium accounts
  const arciumAccounts = {
    mxeAccount: getMXEAccAddress(programId).toBase58(),
    mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET).toBase58(),
    executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET).toBase58(),
    computationAccount: getComputationAccAddress(ARCIUM_CLUSTER_OFFSET, computationOffset).toBase58(),
    compDefAccount: getCompDefAccAddress(
      programId,
      Buffer.from(getCompDefAccOffset('process_claim_v2')).readUInt32LE()
    ).toBase58(),
    clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET).toBase58(),
    poolAccount: getFeePoolAccAddress().toBase58(),
    clockAccount: getClockAccAddress().toBase58(),
    arciumProgram: getArciumProgramId().toBase58(),
  }

  const [schedulePda] = findSchedulePda(organization, schedule.scheduleId.toNumber())

  return {
    positionPda: positionPda.toBase58(),
    schedulePda: schedulePda.toBase58(),
    claimAuthorizationPda: claimAuthorizationPda.toBase58(),
    nullifierPda: nullifierPda.toBase58(),
    signPda: signPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    vaultAuthorityPda: vaultAuthorityPda.toBase58(),

    vestingProgress,

    encryptedTotalAmount: encTotalAmount.ciphertext,
    encryptedClaimedAmount: encClaimedAmount.ciphertext,
    encryptedVestingNumerator: encVestingNumerator.ciphertext,
    encryptedClaimAmount: encClaimAmount.ciphertext,
    clientPubkey: Array.from(encClaimAmount.publicKey),
    nonce: encClaimAmount.nonce.toString(),
    computationOffset: computationOffset.toString(),

    arciumAccounts,
    programId: programId.toBase58(),
  }
}
