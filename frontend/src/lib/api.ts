/**
 * Backend API Client
 *
 * Handles all communication with the ShadowVest backend.
 */

import { API_URL } from './constants'

// =============================================================================
// Types
// =============================================================================

export type UserRole = 'ADMIN' | 'EMPLOYEE' | 'BOTH' | 'NONE'

export interface ApiUser {
  id: string
  createdAt: string
  updatedAt: string
  wallets: ApiWallet[]
  links: ApiLink[]
}

export interface ApiWallet {
  id: string
  userId: string
  chain: 'SOLANA' | 'SUI'
  address: string
  metaSpendPub: string | null
  metaViewPub: string | null
  createdAt: string
  updatedAt: string
}

export interface ApiLink {
  id: string
  slug: string
  label: string | null
  description: string | null
  fullUrl: string
  isActive: boolean
  positionsReceived: number
  wallet: {
    address: string
    chain: string
    metaSpendPub: string | null
    metaViewPub: string | null
  }
  createdAt: string
}

export interface ApiRoleInfo {
  role: UserRole
  isAdmin: boolean
  isEmployee: boolean
  organization?: {
    id: string
    pubkey: string
    isActive: boolean
  }
  links: Array<{
    id: string
    slug: string
    positionsReceived: number
  }>
  positionsCount: number
}

export interface ApiMetaAddress {
  metaSpendPub: string
  metaViewPub: string
}

export interface ApiOrganization {
  id: string
  pubkey: string
  adminWallet: string
  nameHash: string
  tokenMint: string
  treasury: string
  isActive: boolean
  scheduleCount: number
  positionCount: number
}

export interface ApiSchedule {
  id: string
  pubkey: string
  scheduleIndex: number
  cliffDuration: string
  totalDuration: string
  vestingInterval: string
}

export interface ApiPosition {
  id: string
  pubkey: string
  scheduleIndex: number
  employee: {
    slug: string
    label: string | null
  } | null
  startTimestamp: string
  isActive: boolean
}

export interface PreparePositionOnChainResponse {
  positionId: number
  positionPda: string
  schedulePda: string
  signPda: string
  beneficiaryCommitment: number[]
  encryptedAmount: number[]
  clientPubkey: number[]
  nonce: string
  computationOffset: string
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
  // Stealth address data (for StealthPaymentEvent emission)
  stealthAddress: string
  ephemeralPub: string
  encryptedPayload: number[] // 128 bytes for on-chain StealthPaymentEvent
}

export interface VestingProgressInfo {
  positionId: number
  startTimestamp: number
  cliffEndTime: number
  vestingEndTime: number
  currentTime: number
  vestingProgress: number
  vestingNumerator: number
  isInCliff: boolean
  isFullyVested: boolean
  status: 'cliff' | 'vesting' | 'vested'
  timeUntilCliff: number
  timeUntilFullyVested: number
  startDate: string
  cliffEndDate: string
  vestingEndDate: string
}

export interface ApiMyPosition {
  id: string
  pubkey: string
  positionId: number
  organizationPubkey: string
  tokenMint: string
  scheduleIndex: number
  schedulePubkey: string
  stealthOwner: string
  ephemeralPub: string
  encryptedEphemeralPayload: string | null
  isCompressed: boolean
  startTimestamp: string
  cliffEndTime: number
  vestingEndTime: number
  vestingProgress: number
  status: 'cliff' | 'vesting' | 'vested'
  isInCliff: boolean
  isFullyVested: boolean
  isActive: boolean
  receivedVia: {
    slug: string
    label: string | null
  } | null
}

export interface PrepareClaimResponse {
  positionPda: string
  schedulePda: string
  claimAuthorizationPda: string
  nullifierPda: string
  signPda: string
  vaultPda: string
  vaultAuthorityPda: string
  vestingProgress: VestingProgressInfo
  encryptedTotalAmount: number[]
  encryptedClaimedAmount: number[]
  encryptedVestingNumerator: number[]
  encryptedClaimAmount: number[]
  clientPubkey: number[]
  nonce: string
  computationOffset: string
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

export interface PrepareVaultWriteResponse {
  vaultPda: string
  signPda: string
  computationOffset: string
  encryptedSpendLo: number[]
  encryptedSpendHi: number[]
  encryptedViewLo: number[]
  encryptedViewHi: number[]
  clientPubkey: number[]
  userNonce: string
  mxeNonce: string
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

export interface PrepareVaultReadResponse {
  vaultPda: string
  signPda: string
  computationOffset: string
  clientPubkey: number[]
  sessionNonce: string
  sessionPrivKeyHex: string // For decryption on frontend
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

// =============================================================================
// API Client Class
// =============================================================================

class ApiClient {
  private baseUrl: string
  private token: string | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    // Load token from localStorage on init
    this.token = localStorage.getItem('shadowvest_token')
  }

  // ---------------------------------------------------------------------------
  // Token Management
  // ---------------------------------------------------------------------------

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('shadowvest_token', token)
    } else {
      localStorage.removeItem('shadowvest_token')
    }
  }

  getToken(): string | null {
    return this.token
  }

  isAuthenticated(): boolean {
    return !!this.token
  }

  // ---------------------------------------------------------------------------
  // HTTP Helpers
  // ---------------------------------------------------------------------------

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    })

    const data = await response.json()

    if (!response.ok) {
      throw new ApiError(data.error || 'Request failed', response.status, data)
    }

    return data
  }

  // ---------------------------------------------------------------------------
  // Auth Endpoints
  // ---------------------------------------------------------------------------

  async getNonce(walletAddress: string): Promise<{ nonce: string; message: string }> {
    const data = await this.request<{
      success: boolean
      nonce: string
      message: string
    }>(`/api/auth/nonce?walletAddress=${walletAddress}`)
    return { nonce: data.nonce, message: data.message }
  }

  async connect(
    walletAddress: string,
    signature: string,
    message: string,
    chain: 'SOLANA' | 'SUI' = 'SOLANA'
  ): Promise<{ user: ApiUser; role: ApiRoleInfo; token: string }> {
    const data = await this.request<{
      success: boolean
      user: ApiUser
      role: ApiRoleInfo
      token: string
    }>('/api/auth/connect', {
      method: 'POST',
      body: JSON.stringify({ walletAddress, signature, message, chain }),
    })

    // Store token
    this.setToken(data.token)

    return { user: data.user, role: data.role, token: data.token }
  }

  async getMe(): Promise<{ user: ApiUser; role: ApiRoleInfo }> {
    const data = await this.request<{
      success: boolean
      user: ApiUser
      role: ApiRoleInfo
    }>('/api/auth/me')
    return { user: data.user, role: data.role }
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' })
    } finally {
      this.setToken(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Stealth Key Endpoints
  // ---------------------------------------------------------------------------

  async registerStealthKeys(
    walletId: string,
    metaSpendPub: string,
    metaViewPub: string
  ): Promise<{ wallet: ApiWallet }> {
    const data = await this.request<{
      success: boolean
      wallet: ApiWallet
    }>('/api/stealth/register', {
      method: 'POST',
      body: JSON.stringify({ walletId, metaSpendPub, metaViewPub }),
    })
    return { wallet: data.wallet }
  }

  async hasStealthKeys(walletId: string): Promise<{
    hasKeys: boolean
    metaSpendPub?: string
    metaViewPub?: string
  }> {
    const data = await this.request<{
      success: boolean
      hasKeys: boolean
      metaSpendPub?: string
      metaViewPub?: string
    }>(`/api/stealth/has-keys/${walletId}`)
    return {
      hasKeys: data.hasKeys,
      metaSpendPub: data.metaSpendPub,
      metaViewPub: data.metaViewPub,
    }
  }

  async getMyMetaAddress(): Promise<ApiMetaAddress> {
    const data = await this.request<{
      success: boolean
      metaAddress: ApiMetaAddress
    }>('/api/stealth/my-meta-address')
    return data.metaAddress
  }

  async resetStealthKeys(): Promise<void> {
    await this.request<{
      success: boolean
      message: string
    }>('/api/stealth/reset-keys', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  async prepareVaultWrite(
    spendPrivKeyHex: string,
    viewPrivKeyHex: string
  ): Promise<PrepareVaultWriteResponse> {
    const data = await this.request<{
      success: boolean
      data: PrepareVaultWriteResponse
    }>('/api/stealth/prepare-vault-write', {
      method: 'POST',
      body: JSON.stringify({ spendPrivKeyHex, viewPrivKeyHex }),
    })
    return data.data
  }

  async prepareVaultRead(): Promise<PrepareVaultReadResponse> {
    const data = await this.request<{
      success: boolean
      data: PrepareVaultReadResponse
    }>('/api/stealth/prepare-vault-read', {
      method: 'POST',
      body: JSON.stringify({}), // Empty body to avoid parsing issues
    })
    return data.data
  }

  async decryptVaultEvent(params: {
    sessionPrivKeyHex: string
    encryptedSpendLo: number[]
    encryptedSpendHi: number[]
    encryptedViewLo: number[]
    encryptedViewHi: number[]
    nonce: number[]
  }): Promise<{ spendPrivKeyHex: string; viewPrivKeyHex: string }> {
    const data = await this.request<{
      success: boolean
      data: { spendPrivKeyHex: string; viewPrivKeyHex: string }
    }>('/api/stealth/decrypt-vault-event', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return data.data
  }

  // ---------------------------------------------------------------------------
  // Link Endpoints
  // ---------------------------------------------------------------------------

  async checkSlugAvailable(slug: string): Promise<{
    available: boolean
    reason: string | null
  }> {
    const data = await this.request<{
      success: boolean
      available: boolean
      reason: string | null
    }>(`/api/links/check/${slug}`)
    return { available: data.available, reason: data.reason }
  }

  async createLink(
    slug: string,
    walletId: string,
    label?: string,
    description?: string
  ): Promise<ApiLink> {
    const data = await this.request<{
      success: boolean
      link: ApiLink
    }>('/api/links/create', {
      method: 'POST',
      body: JSON.stringify({ slug, walletId, label, description }),
    })
    return data.link
  }

  async getLink(slug: string): Promise<{
    metaAddress: ApiMetaAddress
    label: string | null
  }> {
    const data = await this.request<{
      success: boolean
      metaAddress: ApiMetaAddress
      label: string | null
    }>(`/api/links/${slug}`)
    return { metaAddress: data.metaAddress, label: data.label }
  }

  async getMyLinks(): Promise<ApiLink[]> {
    const data = await this.request<{
      success: boolean
      links: ApiLink[]
    }>('/api/links/my-links')
    return data.links
  }

  async updateLink(
    linkId: string,
    updates: { label?: string; description?: string; isActive?: boolean }
  ): Promise<ApiLink> {
    const data = await this.request<{
      success: boolean
      link: ApiLink
    }>(`/api/links/${linkId}/update`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
    return data.link
  }

  async deleteLink(linkId: string): Promise<void> {
    await this.request(`/api/links/${linkId}`, { method: 'DELETE' })
  }

  // ---------------------------------------------------------------------------
  // Organization Endpoints
  // ---------------------------------------------------------------------------

  async getRole(): Promise<ApiRoleInfo> {
    const data = await this.request<{
      success: boolean
    } & ApiRoleInfo>('/api/organizations/role')
    return {
      role: data.role,
      isAdmin: data.isAdmin,
      isEmployee: data.isEmployee,
      organization: data.organization,
      links: data.links,
      positionsCount: data.positionsCount,
    }
  }

  async getMyOrganization(): Promise<ApiOrganization | null> {
    const data = await this.request<{
      success: boolean
      organization: ApiOrganization | null
    }>('/api/organizations/mine')
    return data.organization
  }

  async linkOrganization(
    pubkey: string,
    adminWallet: string,
    nameHash: string,
    tokenMint: string,
    treasury: string
  ): Promise<ApiOrganization> {
    const data = await this.request<{
      success: boolean
      organization: ApiOrganization
    }>('/api/organizations/link', {
      method: 'POST',
      body: JSON.stringify({ pubkey, adminWallet, nameHash, tokenMint, treasury }),
    })
    return data.organization
  }

  async lookupEmployee(slug: string): Promise<{
    slug: string
    label: string | null
    metaAddress: ApiMetaAddress
  }> {
    const data = await this.request<{
      success: boolean
      employee: {
        slug: string
        label: string | null
        metaAddress: ApiMetaAddress
      }
    }>('/api/organizations/lookup-employee', {
      method: 'POST',
      body: JSON.stringify({ slug }),
    })
    return data.employee
  }

  // ---------------------------------------------------------------------------
  // Schedule Endpoints (MVP - database only)
  // ---------------------------------------------------------------------------

  async createSchedule(params: {
    organizationPubkey: string
    scheduleIndex: number
    cliffDuration: number
    totalDuration: number
    vestingInterval: number
  }): Promise<ApiSchedule> {
    const data = await this.request<{
      success: boolean
      schedule: ApiSchedule
    }>('/api/organizations/schedules/create', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return data.schedule
  }

  async getSchedules(organizationPubkey: string): Promise<ApiSchedule[]> {
    const data = await this.request<{
      success: boolean
      schedules: ApiSchedule[]
    }>(`/api/organizations/${organizationPubkey}/schedules`)
    return data.schedules
  }

  // ---------------------------------------------------------------------------
  // Position Endpoints (MVP - database only)
  // ---------------------------------------------------------------------------

  async createPosition(params: {
    organizationPubkey: string
    scheduleId: string
    employeeSlug: string
    amount: string
    tokenSymbol?: string
  }): Promise<{
    id: string
    pubkey: string
    scheduleId: string
    employeeSlug: string
    amount: string
    tokenSymbol?: string
    startTimestamp: string
  }> {
    const data = await this.request<{
      success: boolean
      position: {
        id: string
        pubkey: string
        scheduleId: string
        employeeSlug: string
        amount: string
        tokenSymbol?: string
        startTimestamp: string
      }
    }>('/api/organizations/positions/create', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return data.position
  }

  async getPositions(organizationPubkey: string): Promise<ApiPosition[]> {
    const data = await this.request<{
      success: boolean
      positions: ApiPosition[]
    }>(`/api/organizations/${organizationPubkey}/positions`)
    return data.positions
  }

  // ---------------------------------------------------------------------------
  // On-Chain Position Creation (Arcium MPC via Backend Relay)
  // ---------------------------------------------------------------------------

  async preparePositionOnChain(params: {
    organizationPubkey: string
    scheduleIndex: number
    employeeSlug: string
    amount: string
  }): Promise<PreparePositionOnChainResponse> {
    const data = await this.request<{
      success: boolean
      data: PreparePositionOnChainResponse
    }>('/api/organizations/positions/prepare-onchain', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return data.data
  }

  // ---------------------------------------------------------------------------
  // Vesting Progress & Claims
  // ---------------------------------------------------------------------------

  async prepareClaim(params: {
    organizationPubkey: string
    positionId: number
    claimAmount: string
    nullifier: string // Hex-encoded 32 bytes
  }): Promise<PrepareClaimResponse> {
    const data = await this.request<{
      success: boolean
      data: PrepareClaimResponse
    }>('/api/organizations/claims/prepare', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return data.data
  }

  // ---------------------------------------------------------------------------
  // Compressed Position Claim Endpoints
  // ---------------------------------------------------------------------------

  /**
   * Get stealth private keys from Arcium MPC vault
   * These are needed to derive the stealth signing keypair for claims
   */
  async getStealthKeys(): Promise<{
    spendPrivKey: string
    viewPrivKey: string
  }> {
    const data = await this.request<{
      success: boolean
      spendPrivKey: string
      viewPrivKey: string
    }>('/api/stealth/keys')
    return {
      spendPrivKey: data.spendPrivKey,
      viewPrivKey: data.viewPrivKey,
    }
  }

  /**
   * Get ephemeral public key for a stealth payment (position)
   * This is the R value stored during position creation
   */
  async getStealthPaymentEphemeralKey(params: {
    organizationPubkey: string
    positionId: number
  }): Promise<string> {
    const data = await this.request<{
      success: boolean
      ephemeralPubkey: string
    }>(`/api/stealth/payment/${params.organizationPubkey}/${params.positionId}/ephemeral-key`)
    return data.ephemeralPubkey
  }

  /**
   * Get encrypted payload for a stealth payment
   * This contains the encrypted ephemeral private key
   */
  async getStealthPaymentPayload(params: {
    organizationPubkey: string
    positionId: number
  }): Promise<string> {
    const data = await this.request<{
      success: boolean
      encryptedPayload: string
    }>(`/api/stealth/payment/${params.organizationPubkey}/${params.positionId}/payload`)
    return data.encryptedPayload
  }

  /**
   * Queue MPC process_claim computation
   * This triggers the backend to run the full Arcium MPC claim flow:
   * 1. Create scratch position
   * 2. Queue process_claim_v2
   * 3. Update compressed position
   * 4. Withdraw tokens
   */
  /**
   * Prepare scratch position data for frontend to create
   * The frontend must create the scratch position because:
   * - createVestingPosition requires admin signature
   * - User's wallet is the org admin, not the backend service
   */
  async prepareScratchPosition(params: {
    organizationPubkey: string
    scheduleIndex: number
    beneficiaryCommitment: number[] // 32-byte array
  }): Promise<PreparePositionOnChainResponse> {
    const data = await this.request<{
      success: boolean
      data: PreparePositionOnChainResponse
    }>('/api/organizations/claims/prepare-scratch', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return data.data
  }

  async queueProcessClaim(params: {
    organizationPubkey: string
    positionId: number
    claimAuthPda: string
    isCompressed: boolean
    nullifier: number[] // 32-byte array
    destinationTokenAccount: string
    claimAmount: string
    beneficiaryCommitment: number[] // 32-byte commitment for scratch position
    scheduleIndex?: number
  }): Promise<{
    jobId: string
    status: string
    claimAmount?: string
    txSignatures?: string[]
    error?: string
  }> {
    const data = await this.request<{
      success: boolean
      jobId: string
      status: string
      claimAmount?: string
      txSignatures?: string[]
      error?: string
    }>('/api/organizations/claims/queue-process', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return {
      jobId: data.jobId,
      status: data.status,
      claimAmount: data.claimAmount,
      txSignatures: data.txSignatures,
      error: data.error,
    }
  }

  /**
   * Get vesting progress for a position (supports both regular and compressed)
   */
  async getVestingProgress(params: {
    organizationPubkey: string
    positionId: number
    isCompressed?: boolean
  }): Promise<VestingProgressInfo> {
    const data = await this.request<{
      success: boolean
      progress: VestingProgressInfo
    }>('/api/organizations/vesting-progress', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return data.progress
  }

  /**
   * Get Address Lookup Table for an organization
   */
  async getOrganizationALT(organizationPubkey: string): Promise<string | null> {
    try {
      const data = await this.request<{
        success: boolean
        altAddress: string | null
      }>(`/api/organizations/${organizationPubkey}/alt`)
      return data.altAddress
    } catch {
      return null
    }
  }

  /**
   * Set Address Lookup Table for an organization
   */
  async setOrganizationALT(organizationPubkey: string, altAddress: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/organizations/${organizationPubkey}/alt`, {
      method: 'POST',
      body: JSON.stringify({ altAddress }),
    })
  }

  /**
   * Get all positions owned by the authenticated user
   * Uses database ownership (via links) rather than on-chain commitment scanning
   */
  async getMyPositions(): Promise<ApiMyPosition[]> {
    const data = await this.request<{
      success: boolean
      positions: ApiMyPosition[]
    }>('/api/organizations/my-positions')
    return data.positions
  }
}

// =============================================================================
// Error Class
// =============================================================================

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const api = new ApiClient(API_URL)
