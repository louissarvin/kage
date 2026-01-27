import { PublicKey } from '@solana/web3.js'

export interface Organization {
  publicKey: PublicKey
  admin: PublicKey
  nameHash: Uint8Array
  scheduleCount: number
  positionCount: number
  compressedPositionCount: number
  treasury: PublicKey
  tokenMint: PublicKey
  isActive: boolean
}

export interface VestingSchedule {
  publicKey: PublicKey
  organization: PublicKey
  scheduleId: number
  cliffDuration: number
  totalDuration: number
  vestingInterval: number
  tokenMint: PublicKey
  isActive: boolean
  positionCount: number
  compressedPositionCount: number
}

export interface VestingPosition {
  publicKey: PublicKey
  organization: PublicKey
  schedule: PublicKey
  positionId: number
  beneficiaryCommitment: Uint8Array
  encryptedTotalAmount: Uint8Array
  encryptedClaimedAmount: Uint8Array
  nonce: bigint
  startTimestamp: number
  isActive: boolean
  isFullyClaimed: boolean
}

export interface ClaimAuthorization {
  publicKey: PublicKey
  position: PublicKey
  nullifier: Uint8Array
  withdrawalDestination: PublicKey
  claimAmount: number
  isAuthorized: boolean
  isProcessed: boolean
  isWithdrawn: boolean
  authorizedAt: number
}

export interface StealthMetaAddress {
  publicKey: PublicKey
  owner: PublicKey
  spendingPubkey: Uint8Array
  viewingPubkey: Uint8Array
}

export type UserRole = 'employee' | 'employer' | 'none'

export interface UserState {
  role: UserRole
  organizations: Organization[]
  positions: VestingPosition[]
  pendingClaims: ClaimAuthorization[]
}
