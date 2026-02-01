/**
 * Compressed Position SDK
 *
 * Light Protocol compressed account support for ShadowVest vesting positions.
 * Compressed accounts provide opaque state storage with on-chain verification.
 *
 * Based on: /Users/macbookair/Documents/kage/contract/tests/stealth-compressed-flow.ts
 */

import { PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import {
  Rpc,
  createRpc,
  bn,
  deriveAddressSeedV2,
  deriveAddressV2,
  defaultTestStateTreeAccounts,
  batchAddressTree,
  PackedAccounts,
  SystemAccountMetaConfig,
  featureFlags,
  VERSION,
} from '@lightprotocol/stateless.js'
import type { ShadowVestProgram } from './program'
import { PROGRAM_ID } from './program'

// Enable V2 mode for Light Protocol
featureFlags.version = VERSION.V2

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed compressed position data from Light Protocol account
 */
export interface CompressedPositionData {
  owner: PublicKey
  organization: PublicKey
  schedule: PublicKey
  positionId: number
  beneficiaryCommitment: Uint8Array
  encryptedTotalAmount: Uint8Array
  encryptedClaimedAmount: Uint8Array
  nonce: bigint
  startTimestamp: number
  isActive: number
  isFullyClaimed: number
}

/**
 * Full compressed position result including tree info for claims
 */
export interface CompressedPositionWithAccount {
  data: CompressedPositionData
  address: PublicKey
  hash: Uint8Array
  treeInfo: {
    tree: PublicKey
    queue: PublicKey
  }
}

/**
 * Parameters for creating a compressed vesting position
 */
export interface CreateCompressedPositionParams {
  program: ShadowVestProgram
  lightRpc: Rpc
  organization: PublicKey
  schedule: PublicKey
  /** Raw 32-byte beneficiary commitment (spend pubkey or hash) */
  beneficiaryCommitment: Uint8Array
  /** Arcium-encrypted amount (32 bytes) */
  encryptedAmount: number[]
  /** Encryption nonce */
  nonce: BN
  /** For stealth positions: one-time stealth address */
  stealthAddress?: PublicKey
  /** For stealth positions: ephemeral public key (32 bytes) */
  ephemeralPubkey?: Uint8Array
  /** For stealth positions: encrypted payload (128 bytes) */
  encryptedPayload?: Uint8Array
}

/**
 * Result of creating a compressed position
 */
export interface CreateCompressedPositionResult {
  signature: string
  positionId: number
  compressedAddress: PublicKey
}

/**
 * Parameters for authorizing a claim on a compressed position
 */
export interface AuthorizeClaimCompressedParams {
  program: ShadowVestProgram
  lightRpc: Rpc
  organization: PublicKey
  positionId: number
  compressedAddress: PublicKey
  nullifier: Uint8Array
  destination: PublicKey
  /** Ed25519 signature from stealth signer */
  signature: Uint8Array
  /** Stealth signer public key */
  signerPubkey: PublicKey
}

/**
 * Parameters for updating a compressed position's claimed amount
 */
export interface UpdateCompressedPositionParams {
  program: ShadowVestProgram
  lightRpc: Rpc
  organization: PublicKey
  compressedAddress: PublicKey
  claimAuthorizationPda: PublicKey
  /** New encrypted claimed amount from MPC callback */
  newEncryptedClaimedAmount: number[]
  /** Whether position is now fully claimed */
  newIsFullyClaimed: number
}

// =============================================================================
// Light RPC Initialization
// =============================================================================

/**
 * Create a Light Protocol RPC client
 *
 * @param rpcEndpoint - Solana RPC endpoint URL
 * @returns Light Protocol Rpc instance
 */
export function createLightRpc(rpcEndpoint: string): Rpc {
  return createRpc(rpcEndpoint, rpcEndpoint, rpcEndpoint)
}

// =============================================================================
// Address Derivation
// =============================================================================

/**
 * Derive the compressed position address
 *
 * Uses Light Protocol V2 address derivation with the program ID.
 *
 * @param organization - Organization public key
 * @param positionId - Position ID within the organization
 * @param programId - ShadowVest program ID (defaults to PROGRAM_ID)
 * @returns Derived address and address seed
 */
export function deriveCompressedPositionAddress(
  organization: PublicKey,
  positionId: number,
  programId: PublicKey = PROGRAM_ID
): { address: PublicKey; addressSeed: Uint8Array } {
  const positionIdBytes = Buffer.alloc(8)
  positionIdBytes.writeBigUInt64LE(BigInt(positionId))

  const addressSeeds = [
    Buffer.from('compressed_position'),
    organization.toBuffer(),
    positionIdBytes,
  ]

  const addressSeed = deriveAddressSeedV2(addressSeeds)
  const addressMerkleTree = new PublicKey(batchAddressTree)
  const address = new PublicKey(
    deriveAddressV2(addressSeed, addressMerkleTree, programId)
  )

  return { address, addressSeed }
}

// =============================================================================
// Serialization Helpers
// =============================================================================

/**
 * Serialize a validity proof for on-chain consumption
 *
 * ValidityProof is Option<CompressedProof>:
 * - 0x00 for None
 * - 0x01 + a(32) + b(64) + c(32) = 129 bytes for Some
 */
export function serializeValidityProof(proof: {
  compressedProof?: { a: Uint8Array | number[]; b: Uint8Array | number[]; c: Uint8Array | number[] } | null
}): Buffer {
  if (proof.compressedProof) {
    const result = Buffer.alloc(129)
    result[0] = 1 // Some variant discriminant
    Buffer.from(proof.compressedProof.a).copy(result, 1)
    Buffer.from(proof.compressedProof.b).copy(result, 33)
    Buffer.from(proof.compressedProof.c).copy(result, 97)
    return result
  }
  // None variant
  return Buffer.from([0])
}

/**
 * Serialize packed address tree info for account creation
 *
 * Rust struct layout:
 * - address_merkle_tree_pubkey_index: u8
 * - address_queue_pubkey_index: u8
 * - root_index: u16
 */
export function serializePackedAddressTreeInfo(info: {
  rootIndex: number
  addressMerkleTreePubkeyIndex: number
  addressQueuePubkeyIndex: number
}): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt8(info.addressMerkleTreePubkeyIndex, 0)
  buffer.writeUInt8(info.addressQueuePubkeyIndex, 1)
  buffer.writeUInt16LE(info.rootIndex, 2)
  return buffer
}

/**
 * Serialize compressed account meta for read operations
 *
 * Layout:
 * - PackedStateTreeInfo (9 bytes)
 * - address (32 bytes)
 * - outputStateTreeIndex (1 byte)
 */
export function serializeCompressedAccountMeta(
  proof: { rootIndices: number[]; leafIndices: number[] },
  compressedPositionAddress: PublicKey
): Buffer {
  const buffer = Buffer.alloc(42)
  let offset = 0

  // tree_info: PackedStateTreeInfo
  buffer.writeUInt16LE(proof.rootIndices[0] || 0, offset) // root_index
  offset += 2
  buffer.writeUInt8(0, offset) // proveByIndex (false)
  offset += 1
  buffer.writeUInt8(0, offset) // merkleTreePubkeyIndex (index 0 in tree section)
  offset += 1
  buffer.writeUInt8(1, offset) // queuePubkeyIndex (index 1 in tree section)
  offset += 1
  buffer.writeUInt32LE(proof.leafIndices[0] || 0, offset) // leaf_index
  offset += 4

  // address (32 bytes)
  compressedPositionAddress.toBuffer().copy(buffer, offset)
  offset += 32

  // outputStateTreeIndex (use same tree for output)
  buffer.writeUInt8(0, offset) // Use merkleTree (index 0)

  return buffer
}

/**
 * Serialize compressed account meta for update operations
 */
export function serializeCompressedAccountMetaForUpdate(meta: {
  address: number[]
  merkleTreePubkeyIndex: number
  queuePubkeyIndex: number
  leafIndex: number
  rootIndex: number
}): Buffer {
  const buffer = Buffer.alloc(42)
  let offset = 0

  // tree_info: PackedStateTreeInfo
  buffer.writeUInt16LE(meta.rootIndex, offset)
  offset += 2
  buffer.writeUInt8(0, offset) // proveByIndex (false)
  offset += 1
  buffer.writeUInt8(meta.merkleTreePubkeyIndex, offset)
  offset += 1
  buffer.writeUInt8(meta.queuePubkeyIndex, offset)
  offset += 1
  buffer.writeUInt32LE(meta.leafIndex, offset)
  offset += 4

  // address (32 bytes)
  Buffer.from(meta.address).copy(buffer, offset)
  offset += 32

  // outputStateTreeIndex
  buffer.writeUInt8(meta.merkleTreePubkeyIndex, offset)

  return buffer
}

// =============================================================================
// Account Parsing
// =============================================================================

/**
 * Parse compressed position data from raw account bytes
 *
 * Note: Light Protocol stores discriminator separately, so we parse from offset 0.
 * However, if data length is 234 bytes (226 + 8), there may be a discriminator to skip.
 */
export function parseCompressedPositionData(data: Buffer): CompressedPositionData {
  // Debug: Log raw data to diagnose organization mismatch
  console.log('[SDK] Raw compressed position data:')
  console.log('  Total length:', data.length)
  console.log('  First 16 bytes (hex):', data.slice(0, 16).toString('hex'))

  let offset = 0

  // Check if there's a discriminator - Light Protocol may include one in some versions
  // Expected size without discriminator: 226 bytes (32+32+32+8+32+32+32+16+8+1+1)
  if (data.length === 234 || data.length > 230) {
    console.log('[SDK] Detected possible 8-byte discriminator, skipping...')
    offset = 8
  }

  const ownerOffset = offset
  const owner = new PublicKey(data.slice(offset, offset + 32))
  console.log('  Owner at offset', ownerOffset, ':', owner.toBase58())
  offset += 32

  const orgOffset = offset
  const organization = new PublicKey(data.slice(offset, offset + 32))
  console.log('  Organization at offset', orgOffset, ':', organization.toBase58())
  offset += 32

  const scheduleOffset = offset
  const schedule = new PublicKey(data.slice(offset, offset + 32))
  console.log('  Schedule at offset', scheduleOffset, ':', schedule.toBase58())
  offset += 32

  const positionId = Number(data.readBigUInt64LE(offset))
  offset += 8

  const beneficiaryCommitment = new Uint8Array(data.slice(offset, offset + 32))
  offset += 32

  const encryptedTotalAmount = new Uint8Array(data.slice(offset, offset + 32))
  offset += 32

  const encryptedClaimedAmount = new Uint8Array(data.slice(offset, offset + 32))
  offset += 32

  const nonceLo = data.readBigUInt64LE(offset)
  const nonceHi = data.readBigUInt64LE(offset + 8)
  const nonce = nonceLo | (nonceHi << BigInt(64))
  offset += 16

  const startTimestamp = Number(data.readBigInt64LE(offset))
  offset += 8

  const isActive = data.readUInt8(offset)
  offset += 1

  const isFullyClaimed = data.readUInt8(offset)

  return {
    owner,
    organization,
    schedule,
    positionId,
    beneficiaryCommitment,
    encryptedTotalAmount,
    encryptedClaimedAmount,
    nonce,
    startTimestamp,
    isActive,
    isFullyClaimed,
  }
}

// =============================================================================
// Remaining Accounts Builders
// =============================================================================

/**
 * Build Light Protocol remaining accounts from tree accounts
 *
 * @param treeAccounts - Array of tree public keys
 * @param programId - ShadowVest program ID
 * @returns Array of account metas for remaining accounts
 */
export function buildLightRemainingAccountsFromTrees(
  treeAccounts: PublicKey[],
  programId: PublicKey
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const packedAccounts = new PackedAccounts()
  const systemAccountConfig = SystemAccountMetaConfig.new(programId)
  packedAccounts.addSystemAccountsV2(systemAccountConfig)

  for (const tree of treeAccounts) {
    packedAccounts.insertOrGet(tree)
  }

  const { remainingAccounts } = packedAccounts.toAccountMetas()

  return remainingAccounts.map(
    (acc: { pubkey: PublicKey; isSigner?: boolean; isWritable?: boolean }) => ({
      pubkey: acc.pubkey,
      isSigner: Boolean(acc.isSigner),
      isWritable: Boolean(acc.isWritable),
    })
  )
}

/**
 * Build remaining accounts for Light Protocol CPI UPDATE operations.
 * Tree accounts must be marked as writable for state transitions.
 */
export function buildLightRemainingAccountsForUpdate(
  stateTree: PublicKey,
  nullifierQueue: PublicKey,
  programId: PublicKey
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const packedAccounts = new PackedAccounts()
  const systemAccountConfig = SystemAccountMetaConfig.new(programId)
  packedAccounts.addSystemAccountsV2(systemAccountConfig)

  packedAccounts.insertOrGet(stateTree)
  packedAccounts.insertOrGet(nullifierQueue)

  const { remainingAccounts } = packedAccounts.toAccountMetas()

  // For update operations, explicitly mark tree accounts as writable
  // System accounts are at indices 0-5, tree accounts start at index 6
  return remainingAccounts.map(
    (
      acc: { pubkey: PublicKey; isSigner?: boolean; isWritable?: boolean },
      index: number
    ) => ({
      pubkey: acc.pubkey,
      isSigner: false,
      isWritable: index >= 6 ? true : Boolean(acc.isWritable),
    })
  )
}

// =============================================================================
// Core Operations
// =============================================================================

/**
 * Create a compressed vesting position
 *
 * Supports both regular and stealth compressed positions.
 *
 * @param params - Creation parameters
 * @returns Transaction signature, position ID, and compressed address
 */
export async function createCompressedVestingPosition(
  params: CreateCompressedPositionParams
): Promise<CreateCompressedPositionResult> {
  const { program, lightRpc, organization, schedule, beneficiaryCommitment, encryptedAmount, nonce } = params
  const admin = program.provider.publicKey!

  // Get current position count to determine position ID
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org = await (program.account as any).organization.fetch(organization)
  const positionId = org.compressedPositionCount.toNumber()

  // Get tree accounts
  const trees = defaultTestStateTreeAccounts()
  const stateMerkleTree = trees.merkleTree
  const addressMerkleTree = new PublicKey(batchAddressTree)

  // Derive compressed position address
  const { address: compressedPositionAddress } = deriveCompressedPositionAddress(
    organization,
    positionId,
    program.programId as unknown as PublicKey
  )

  // Get validity proof for new address
  const proof = await lightRpc.getValidityProofV0(
    [],
    [
      {
        address: bn(compressedPositionAddress.toBytes()),
        tree: addressMerkleTree,
        queue: addressMerkleTree,
      },
    ]
  )

  // Build remaining accounts
  const packedAccounts = new PackedAccounts()
  const systemAccountConfig = SystemAccountMetaConfig.new(
    program.programId as unknown as PublicKey
  )
  packedAccounts.addSystemAccountsV2(systemAccountConfig)

  const outputStateTreeIndex = packedAccounts.insertOrGet(stateMerkleTree)
  const addressMerkleTreePubkeyIndex = packedAccounts.insertOrGet(addressMerkleTree)
  const addressQueuePubkeyIndex = addressMerkleTreePubkeyIndex

  const { remainingAccounts } = packedAccounts.toAccountMetas()

  // Serialize proof and address tree info
  const proofBytes = serializeValidityProof(proof)
  const addressTreeInfoBytes = serializePackedAddressTreeInfo({
    rootIndex: proof.rootIndices[0],
    addressMerkleTreePubkeyIndex,
    addressQueuePubkeyIndex,
  })

  // Compute budget instructions
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  })
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000,
  })

  let signature: string

  // Check if this is a stealth position
  if (params.stealthAddress && params.ephemeralPubkey && params.encryptedPayload) {
    // Create stealth compressed position
    signature = await program.methods
      .createCompressedStealthVestingPosition(
        Buffer.from(proofBytes),
        Buffer.from(addressTreeInfoBytes),
        outputStateTreeIndex,
        params.stealthAddress,
        Array.from(params.ephemeralPubkey) as number[],
        Array.from(params.encryptedPayload) as number[],
        encryptedAmount as number[],
        nonce
      )
      .accountsPartial({
        feePayer: admin,
        admin,
        organization,
        schedule,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        remainingAccounts.map(
          (acc: { pubkey: PublicKey; isSigner?: boolean; isWritable?: boolean }) => ({
            pubkey: acc.pubkey,
            isSigner: Boolean(acc.isSigner),
            isWritable: Boolean(acc.isWritable),
          })
        )
      )
      .preInstructions([modifyComputeUnits, addPriorityFee])
      .rpc({ commitment: 'confirmed' })
  } else {
    // Create regular compressed position
    signature = await program.methods
      .createCompressedVestingPosition(
        Buffer.from(proofBytes),
        Buffer.from(addressTreeInfoBytes),
        outputStateTreeIndex,
        Array.from(beneficiaryCommitment) as number[],
        encryptedAmount as number[],
        nonce
      )
      .accountsPartial({
        feePayer: admin,
        admin,
        organization,
        schedule,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        remainingAccounts.map(
          (acc: { pubkey: PublicKey; isSigner?: boolean; isWritable?: boolean }) => ({
            pubkey: acc.pubkey,
            isSigner: Boolean(acc.isSigner),
            isWritable: Boolean(acc.isWritable),
          })
        )
      )
      .preInstructions([modifyComputeUnits, addPriorityFee])
      .rpc({ commitment: 'confirmed' })
  }

  return {
    signature,
    positionId,
    compressedAddress: compressedPositionAddress,
  }
}

/**
 * Fetch a compressed position account
 *
 * @param lightRpc - Light Protocol RPC client
 * @param address - Compressed position address
 * @returns Parsed position data or null if not found
 */
export async function fetchCompressedPosition(
  lightRpc: Rpc,
  address: PublicKey
): Promise<CompressedPositionData | null> {
  try {
    const compressedAccount = await lightRpc.getCompressedAccount(
      bn(address.toBytes())
    )

    if (!compressedAccount || !compressedAccount.data?.data) {
      return null
    }

    return parseCompressedPositionData(Buffer.from(compressedAccount.data.data))
  } catch (error) {
    console.error('Failed to fetch compressed position:', error)
    return null
  }
}

/**
 * Fetch a compressed position with full account info for claims
 *
 * This returns everything needed to authorize a claim:
 * - Parsed position data
 * - Account hash (for validity proof)
 * - Tree info (for validity proof)
 *
 * @param lightRpc - Light Protocol RPC client
 * @param organizationPubkey - Organization public key
 * @param positionId - Position ID
 * @param programId - Program ID (defaults to PROGRAM_ID)
 * @returns Full position data with account info, or null if not found
 */
export async function fetchCompressedPositionForClaim(
  lightRpc: Rpc,
  organizationPubkey: PublicKey,
  positionId: number,
  programId: PublicKey = PROGRAM_ID
): Promise<CompressedPositionWithAccount | null> {
  try {
    // Derive the compressed position address
    const { address: compressedAddress } = deriveCompressedPositionAddress(
      organizationPubkey,
      positionId,
      programId
    )

    // Fetch the compressed account
    const compressedAccount = await lightRpc.getCompressedAccount(
      bn(compressedAddress.toBytes())
    )

    if (!compressedAccount || !compressedAccount.data?.data) {
      console.log('Compressed account not found:', compressedAddress.toString())
      return null
    }

    // Parse position data
    const data = parseCompressedPositionData(Buffer.from(compressedAccount.data.data))

    // Convert hash from BN to Uint8Array
    const hashBytes = compressedAccount.hash.toArray('le', 32)

    return {
      data,
      address: compressedAddress,
      hash: new Uint8Array(hashBytes),
      treeInfo: {
        tree: new PublicKey(compressedAccount.treeInfo.tree),
        queue: new PublicKey(compressedAccount.treeInfo.queue),
      },
    }
  } catch (error) {
    console.error('Failed to fetch compressed position for claim:', error)
    return null
  }
}

/**
 * Authorize a claim on a compressed position
 *
 * This verifies the Ed25519 signature and creates a ClaimAuthorization account.
 *
 * @param params - Authorization parameters
 * @returns Transaction signature
 */
export async function authorizeClaimCompressed(
  params: AuthorizeClaimCompressedParams
): Promise<string> {
  const {
    program,
    lightRpc,
    organization,
    positionId,
    compressedAddress,
    nullifier,
    destination,
  } = params
  const payer = program.provider.publicKey!

  // Fetch compressed account
  const compressedAccount = await lightRpc.getCompressedAccount(
    bn(compressedAddress.toBytes())
  )
  if (!compressedAccount) {
    throw new Error('Compressed account not found')
  }

  // Parse position data
  const positionData = parseCompressedPositionData(
    Buffer.from(compressedAccount.data!.data!)
  )

  // Get validity proof for read
  const proof = await lightRpc.getValidityProofV0(
    [
      {
        hash: compressedAccount.hash,
        tree: compressedAccount.treeInfo.tree,
        queue: compressedAccount.treeInfo.queue,
      },
    ],
    []
  )

  // Build remaining accounts
  const trees = defaultTestStateTreeAccounts()
  const treeAccounts = [trees.merkleTree, trees.nullifierQueue]
  const remainingAccounts = buildLightRemainingAccountsFromTrees(
    treeAccounts,
    program.programId as unknown as PublicKey
  )

  // Serialize
  const proofBytes = serializeValidityProof(proof)
  const accountMetaBytes = serializeCompressedAccountMeta(proof, compressedAddress)

  // Derive PDAs
  const positionIdBytes = Buffer.alloc(8)
  positionIdBytes.writeBigUInt64LE(BigInt(positionId))

  const [claimAuthPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('claim_auth'),
      organization.toBuffer(),
      positionIdBytes,
      Buffer.from(nullifier),
    ],
    program.programId as unknown as PublicKey
  )

  const [nullifierRecordPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), organization.toBuffer(), Buffer.from(nullifier)],
    program.programId as unknown as PublicKey
  )

  // Compute budget
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000,
  })

  // Note: Ed25519 instruction must be added by the caller before this instruction
  // since it requires the signature and public key
  const signature = await program.methods
    .authorizeClaimCompressed(
      Buffer.from(proofBytes),
      Buffer.from(accountMetaBytes),
      positionData.owner,
      positionData.organization,
      positionData.schedule,
      new BN(positionData.positionId),
      Array.from(positionData.beneficiaryCommitment) as number[],
      Array.from(positionData.encryptedTotalAmount) as number[],
      Array.from(positionData.encryptedClaimedAmount) as number[],
      new BN(positionData.nonce.toString()),
      new BN(positionData.startTimestamp),
      positionData.isActive,
      positionData.isFullyClaimed,
      Array.from(nullifier) as number[],
      destination
    )
    .accountsPartial({
      claimAuthorization: claimAuthPda,
      nullifierRecord: nullifierRecordPda,
      organization,
      feePayer: payer,
      instructionsSysvar: new PublicKey('Sysvar1nstructions1111111111111111111111111'),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .preInstructions([computeIx, priorityFeeIx])
    .rpc({ commitment: 'confirmed' })

  return signature
}

/**
 * Build authorize claim instruction (without sending)
 *
 * Use this when you need to combine with Ed25519 verification in a versioned transaction.
 *
 * @param params - Authorization parameters
 * @returns Instruction and related data
 */
export async function buildAuthorizeClaimInstruction(
  params: AuthorizeClaimCompressedParams
): Promise<{
  instruction: ReturnType<typeof program.methods.authorizeClaimCompressed>
  claimAuthPda: PublicKey
  nullifierRecordPda: PublicKey
  proofBytes: Buffer
  accountMetaBytes: Buffer
  positionData: CompressedPositionData
  remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
}> {
  const { program, lightRpc, organization, positionId, compressedAddress, nullifier, destination } =
    params
  const payer = program.provider.publicKey!

  // Fetch compressed account
  const compressedAccount = await lightRpc.getCompressedAccount(
    bn(compressedAddress.toBytes())
  )
  if (!compressedAccount) {
    throw new Error('Compressed account not found')
  }

  // Parse position data
  const positionData = parseCompressedPositionData(
    Buffer.from(compressedAccount.data!.data!)
  )

  // Get validity proof for read
  const proof = await lightRpc.getValidityProofV0(
    [
      {
        hash: compressedAccount.hash,
        tree: compressedAccount.treeInfo.tree,
        queue: compressedAccount.treeInfo.queue,
      },
    ],
    []
  )

  // Build remaining accounts
  const trees = defaultTestStateTreeAccounts()
  const treeAccounts = [trees.merkleTree, trees.nullifierQueue]
  const remainingAccounts = buildLightRemainingAccountsFromTrees(
    treeAccounts,
    program.programId as unknown as PublicKey
  )

  // Serialize
  const proofBytes = serializeValidityProof(proof)
  const accountMetaBytes = serializeCompressedAccountMeta(proof, compressedAddress)

  // Derive PDAs
  const positionIdBytes = Buffer.alloc(8)
  positionIdBytes.writeBigUInt64LE(BigInt(positionId))

  const [claimAuthPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('claim_auth'),
      organization.toBuffer(),
      positionIdBytes,
      Buffer.from(nullifier),
    ],
    program.programId as unknown as PublicKey
  )

  const [nullifierRecordPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), organization.toBuffer(), Buffer.from(nullifier)],
    program.programId as unknown as PublicKey
  )

  const instruction = program.methods
    .authorizeClaimCompressed(
      Buffer.from(proofBytes),
      Buffer.from(accountMetaBytes),
      positionData.owner,
      positionData.organization,
      positionData.schedule,
      new BN(positionData.positionId),
      Array.from(positionData.beneficiaryCommitment) as number[],
      Array.from(positionData.encryptedTotalAmount) as number[],
      Array.from(positionData.encryptedClaimedAmount) as number[],
      new BN(positionData.nonce.toString()),
      new BN(positionData.startTimestamp),
      positionData.isActive,
      positionData.isFullyClaimed,
      Array.from(nullifier) as number[],
      destination
    )
    .accountsPartial({
      claimAuthorization: claimAuthPda,
      nullifierRecord: nullifierRecordPda,
      organization,
      feePayer: payer,
      instructionsSysvar: new PublicKey('Sysvar1nstructions1111111111111111111111111'),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)

  return {
    instruction,
    claimAuthPda,
    nullifierRecordPda,
    proofBytes,
    accountMetaBytes,
    positionData,
    remainingAccounts,
  }
}

/**
 * Update a compressed position's claimed amount
 *
 * Called after MPC callback processes the claim.
 *
 * @param params - Update parameters
 * @returns Transaction signature
 */
export async function updateCompressedPositionClaimed(
  params: UpdateCompressedPositionParams
): Promise<string> {
  const {
    program,
    lightRpc,
    organization,
    compressedAddress,
    claimAuthorizationPda,
    newEncryptedClaimedAmount,
    newIsFullyClaimed,
  } = params
  const payer = program.provider.publicKey!

  // Fetch compressed account
  const compressedAccount = await lightRpc.getCompressedAccount(
    bn(compressedAddress.toBytes())
  )
  if (!compressedAccount) {
    throw new Error('Compressed account not found')
  }

  // Parse position data
  const positionData = parseCompressedPositionData(
    Buffer.from(compressedAccount.data!.data!)
  )

  // Get validity proof for update
  const proof = await lightRpc.getValidityProofV0(
    [
      {
        hash: compressedAccount.hash,
        tree: compressedAccount.treeInfo.tree,
        queue: compressedAccount.treeInfo.queue,
      },
    ],
    []
  )

  // Build remaining accounts for update with writable trees
  const actualTree = new PublicKey(compressedAccount.treeInfo.tree)
  const actualQueue = new PublicKey(compressedAccount.treeInfo.queue)
  const remainingAccounts = buildLightRemainingAccountsForUpdate(
    actualTree,
    actualQueue,
    program.programId as unknown as PublicKey
  )

  // Build account meta for update
  const accountMeta = {
    address: Array.from(compressedAddress.toBytes()),
    merkleTreePubkeyIndex: 0,
    queuePubkeyIndex: 1,
    leafIndex: proof.leafIndices[0],
    rootIndex: proof.rootIndices[0],
  }

  const proofBytes = serializeValidityProof(proof)
  const accountMetaBytes = serializeCompressedAccountMetaForUpdate(accountMeta)

  // Compute budget
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000,
  })

  const signature = await program.methods
    .updateCompressedPositionClaimed(
      Buffer.from(proofBytes),
      Buffer.from(accountMetaBytes),
      positionData.owner,
      positionData.organization,
      positionData.schedule,
      new BN(positionData.positionId),
      Array.from(positionData.beneficiaryCommitment) as number[],
      Array.from(positionData.encryptedTotalAmount) as number[],
      Array.from(positionData.encryptedClaimedAmount) as number[],
      new BN(positionData.nonce.toString()),
      new BN(positionData.startTimestamp),
      positionData.isActive,
      positionData.isFullyClaimed,
      newEncryptedClaimedAmount as number[],
      newIsFullyClaimed
    )
    .accountsPartial({
      feePayer: payer,
      organization,
      claimAuthorization: claimAuthorizationPda,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .preInstructions([computeIx, priorityFeeIx])
    .rpc({ commitment: 'confirmed' })

  return signature
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a nullifier for a compressed position claim
 *
 * nullifier = SHA256(stealth_address || position_id)
 *
 * @param stealthAddress - Stealth address (beneficiary)
 * @param positionId - Position ID
 * @returns 32-byte nullifier
 */
export async function createNullifier(
  stealthAddress: PublicKey,
  positionId: number
): Promise<Uint8Array> {
  const positionIdBytes = Buffer.alloc(8)
  positionIdBytes.writeBigUInt64LE(BigInt(positionId))

  // Use dynamic import for crypto
  const { createHash } = await import('crypto')
  return createHash('sha256')
    .update(Buffer.concat([stealthAddress.toBuffer(), positionIdBytes]))
    .digest()
}

/**
 * Wait for a compressed account to be indexed
 *
 * @param lightRpc - Light Protocol RPC client
 * @param address - Compressed account address
 * @param timeoutMs - Maximum time to wait (default 30s)
 * @param pollIntervalMs - Polling interval (default 2s)
 * @returns Compressed position data when found
 */
export async function waitForCompressedAccount(
  lightRpc: Rpc,
  address: PublicKey,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 2000
): Promise<CompressedPositionData> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const data = await fetchCompressedPosition(lightRpc, address)
    if (data) {
      return data
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error(`Timeout waiting for compressed account at ${address.toString()}`)
}

/**
 * Get the address merkle tree public key for batch operations
 *
 * @returns Address merkle tree public key
 */
export function getAddressMerkleTree(): PublicKey {
  return new PublicKey(batchAddressTree)
}

/**
 * Get default test state tree accounts
 *
 * @returns State tree and nullifier queue public keys
 */
export function getDefaultStateTreeAccounts(): {
  merkleTree: PublicKey
  nullifierQueue: PublicKey
} {
  const trees = defaultTestStateTreeAccounts()
  return {
    merkleTree: trees.merkleTree,
    nullifierQueue: trees.nullifierQueue,
  }
}

// =============================================================================
// Employee Position Scanning
// =============================================================================

/**
 * Compressed position with address for display
 */
export interface CompressedPositionWithAddress {
  address: PublicKey
  data: CompressedPositionData
}

/**
 * Scan compressed positions for an employee by beneficiary commitment
 *
 * This scans all compressed positions in the given organizations and returns
 * those matching the employee's beneficiary commitment.
 *
 * @param lightRpc - Light Protocol RPC client
 * @param organizations - Array of organization pubkeys and their compressed position counts
 * @param beneficiaryCommitment - Employee's beneficiary commitment (32 bytes)
 * @param programId - ShadowVest program ID
 * @returns Array of matching compressed positions
 */
export async function scanCompressedPositionsForEmployee(
  lightRpc: Rpc,
  organizations: Array<{ pubkey: PublicKey; compressedPositionCount: number }>,
  beneficiaryCommitment: Uint8Array,
  programId: PublicKey
): Promise<CompressedPositionWithAddress[]> {
  const matchingPositions: CompressedPositionWithAddress[] = []

  for (const org of organizations) {
    // Scan all compressed positions in this organization
    for (let positionId = 0; positionId < org.compressedPositionCount; positionId++) {
      try {
        // Derive the compressed position address
        const { address } = deriveCompressedPositionAddress(
          org.pubkey,
          positionId,
          programId
        )

        // Fetch the position data
        const positionData = await fetchCompressedPosition(lightRpc, address)

        if (positionData) {
          // Check if beneficiary commitment matches
          const commitmentMatches = arraysEqual(
            positionData.beneficiaryCommitment,
            beneficiaryCommitment
          )

          if (commitmentMatches) {
            matchingPositions.push({
              address,
              data: positionData,
            })
          }
        }
      } catch (error) {
        // Continue scanning even if one position fails
        console.warn(`Failed to fetch compressed position ${positionId} from ${org.pubkey.toString()}:`, error)
      }
    }
  }

  return matchingPositions
}

/**
 * Scan all compressed positions in an organization
 *
 * @param lightRpc - Light Protocol RPC client
 * @param organization - Organization pubkey
 * @param compressedPositionCount - Number of compressed positions
 * @param programId - ShadowVest program ID
 * @returns Array of all compressed positions
 */
export async function fetchAllCompressedPositions(
  lightRpc: Rpc,
  organization: PublicKey,
  compressedPositionCount: number,
  programId: PublicKey
): Promise<CompressedPositionWithAddress[]> {
  const positions: CompressedPositionWithAddress[] = []

  for (let positionId = 0; positionId < compressedPositionCount; positionId++) {
    try {
      const { address } = deriveCompressedPositionAddress(
        organization,
        positionId,
        programId
      )

      const positionData = await fetchCompressedPosition(lightRpc, address)

      if (positionData) {
        positions.push({
          address,
          data: positionData,
        })
      }
    } catch (error) {
      console.warn(`Failed to fetch compressed position ${positionId}:`, error)
    }
  }

  return positions
}

/**
 * Helper to compare two Uint8Arrays
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
