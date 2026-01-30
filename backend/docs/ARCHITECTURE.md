# ShadowVest Backend Architecture

## Overview

This document outlines the backend architecture for ShadowVest, a privacy-first payroll and vesting protocol. The backend handles user management, link-based identity, stealth key storage via Arcium MPC, and position scanning.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│                         (React + Solana Wallet)                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           KAGE BACKEND API                                   │
│                         (Fastify + Prisma)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  • User Authentication (wallet signature)                                    │
│  • Link Management (kage.ink/username)                                      │
│  • Meta-Address Lookup                                                       │
│  • Position Indexing & Caching                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                               │
                    ▼                               ▼
┌───────────────────────────────┐   ┌─────────────────────────────────────────┐
│         ARCIUM MPC            │   │              SOLANA                      │
│    (Confidential Compute)     │   │            (On-Chain)                   │
├───────────────────────────────┤   ├─────────────────────────────────────────┤
│  • metaSpendPriv storage      │   │  • Organization accounts                │
│  • metaViewPriv storage       │   │  • Vesting schedules                    │
│  • Stealth key derivation     │   │  • Vesting positions (stealth)         │
│  • Transaction signing        │   │  • Token vault & withdrawals           │
│  • Position scanning          │   │  • Light Protocol (compressed state)   │
│  • Encrypted amount compute   │   │                                         │
└───────────────────────────────┘   └─────────────────────────────────────────┘
```

---

## User Roles

Roles in ShadowVest are **contextual** - a user can have multiple roles simultaneously:

| Role | How Identified | Capabilities |
|------|----------------|--------------|
| **ADMIN** | Wallet is `admin` of an Organization on-chain | Create schedules, add positions, manage org |
| **EMPLOYEE** | Has a link (kage.ink/username) or owns positions | View positions, claim vested tokens |
| **BOTH** | Is admin of one org AND receives vesting | Full capabilities |
| **NONE** | New user, no setup yet | Can set up as either role |

### Role Detection Flow

```
User connects wallet
       ↓
Check: Is wallet admin of any Organization?
       ├── YES → isAdmin = true
       └── NO  → isAdmin = false
       ↓
Check: Does user have any links or positions?
       ├── YES → isEmployee = true
       └── NO  → isEmployee = false
       ↓
Determine role:
  - isAdmin && isEmployee → BOTH
  - isAdmin only → ADMIN
  - isEmployee only → EMPLOYEE
  - neither → NONE
```

### Role-Based UI

```
┌─────────────────────────────────────────────────────────────────┐
│                         DASHBOARD                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  If role == ADMIN or BOTH:                                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  EMPLOYER SECTION                                           ││
│  │  • Organization management                                  ││
│  │  • Create vesting schedules                                 ││
│  │  • Add employees (enter their kage.ink/username)            ││
│  │  • View all positions you've created                        ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  If role == EMPLOYEE or BOTH:                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  EMPLOYEE SECTION                                           ││
│  │  • Your link: kage.ink/username                             ││
│  │  • Vesting positions you've received                        ││
│  │  • Claim vested tokens                                      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  If role == NONE:                                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ONBOARDING                                                 ││
│  │  • "Create Organization" → become ADMIN                     ││
│  │  • "Create Link" → become EMPLOYEE                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. User & Wallet Management

Users authenticate via wallet signature. Each user can have multiple wallets, and each wallet has associated stealth meta keys stored in Arcium MPC.

### 2. Link System (kage.ink/username)

Links provide human-readable identifiers for receiving vesting positions:
- Employee creates link: `kage.ink/alice`
- Employer enters link to look up meta-address
- System derives stealth address for private vesting

### 3. Arcium MPC Integration (ON-CHAIN)

Arcium MPC is integrated **directly into the Solana smart contract**, not as a separate backend service:

```
Client → Smart Contract → Arcium MPC (on Solana) → metaKeysVault PDA
```

Key storage flow:
1. Client generates stealth meta-keys locally
2. Client encrypts with x25519 using MXE public key
3. Client calls `writeMetaKeysToVault` instruction
4. Arcium MPC stores encrypted keys in on-chain vault PDA
5. To retrieve: Client calls `readMetaKeysFromVault`
6. MPC decrypts and re-encrypts for client via event

**Backend does NOT handle private keys at all** - only stores public meta-address for link lookups.

See: `contract/tests/arcium-meta-keys.ts` for the full on-chain flow.

### 4. Position Scanning

Backend periodically scans on-chain positions to:
- Identify positions belonging to users (via metaViewPriv in MPC)
- Cache position data for fast dashboard loading
- Track vesting progress and claimable amounts

---

## Data Flow

### Employee Registration Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        EMPLOYEE REGISTRATION                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Step 1: Connect Wallet                                                      │
│  ════════════════════                                                        │
│  Frontend prompts wallet connection (Phantom, Backpack, etc.)                │
│                                                                              │
│  Step 2: Sign Authentication Message                                         │
│  ═══════════════════════════════════                                         │
│  Message: "Sign to authenticate with ShadowVest\nNonce: {uuid}\nTime: {ts}"  │
│  Backend verifies signature matches connected wallet                         │
│                                                                              │
│  Step 3: Create Link                                                         │
│  ═══════════════════                                                         │
│  User chooses username: "alice" → kage.ink/alice                            │
│  Backend validates uniqueness                                                │
│                                                                              │
│  Step 4: Generate Stealth Meta Keys (Client-Side, One Time)                  │
│  ══════════════════════════════════════════════════════════                  │
│  const metaSpendKeypair = generateKeypair()  // Ed25519                     │
│  const metaViewKeypair = generateKeypair()   // Ed25519                     │
│                                                                              │
│  Step 5: Store Keys in Arcium MPC                                            │
│  ════════════════════════════════                                            │
│  Frontend sends to Arcium (encrypted in transit):                            │
│  - metaSpendPriv → sharded across MPC nodes                                 │
│  - metaViewPriv → sharded across MPC nodes                                  │
│  Arcium returns: arciumKeyId (reference for retrieval)                       │
│                                                                              │
│  Step 6: Store Public Data in Backend                                        │
│  ════════════════════════════════════                                        │
│  Backend stores:                                                             │
│  - walletAddress                                                             │
│  - metaSpendPub (public key only)                                           │
│  - metaViewPub (public key only)                                            │
│  - arciumKeyId (reference to MPC-stored private keys)                       │
│  - linkSlug: "alice"                                                        │
│                                                                              │
│  Result: Employee ready to receive vesting positions                         │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Employer Creating Position Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      EMPLOYER CREATES POSITION                                │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Step 1: Employer Authenticated                                              │
│  ══════════════════════════════                                              │
│  Employer wallet connected, organization verified                            │
│                                                                              │
│  Step 2: Enter Employee Link                                                 │
│  ═══════════════════════════                                                 │
│  Input: "alice" or "kage.ink/alice"                                         │
│                                                                              │
│  Step 3: Backend Lookup                                                      │
│  ══════════════════════                                                      │
│  GET /api/links/alice/meta-address                                          │
│  Response: { metaSpendPub, metaViewPub }                                    │
│                                                                              │
│  Step 4: Generate Ephemeral Keypair (Frontend)                               │
│  ═════════════════════════════════════════════                               │
│  const ephemeralKeypair = generateKeypair()                                 │
│  // ephemeralPub will be stored on-chain for employee to derive their key   │
│                                                                              │
│  Step 5: Derive Stealth Address (Frontend)                                   │
│  ═════════════════════════════════════════                                   │
│  const stealthPub = deriveStealthPub(                                       │
│    metaSpendPub,    // from backend                                         │
│    metaViewPub,     // from backend                                         │
│    ephemeralPriv    // generated locally                                    │
│  )                                                                           │
│                                                                              │
│  Step 6: Create Position On-Chain                                            │
│  ════════════════════════════════                                            │
│  Transaction includes:                                                       │
│  - stealthOwner: stealthPub (derived above)                                 │
│  - ephemeralPub: for employee to derive their signing key                   │
│  - scheduleId: which vesting schedule to use                                │
│  - encryptedAmount: via Arcium MPC (only visible to employee)               │
│                                                                              │
│  Step 7: Index Position in Backend                                           │
│  ═════════════════════════════════                                           │
│  Backend indexes the new position for fast lookup                            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Employee Claiming Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        EMPLOYEE CLAIMING                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Step 1: Employee Connects Wallet (Any Device)                               │
│  ═════════════════════════════════════════════                               │
│  No localStorage needed - keys are in Arcium MPC                            │
│                                                                              │
│  Step 2: Sign Authentication Message                                         │
│  ═══════════════════════════════════                                         │
│  Proves ownership of wallet → grants access to Arcium-stored keys           │
│                                                                              │
│  Step 3: Backend Requests Position Scan from Arcium                          │
│  ══════════════════════════════════════════════════                          │
│  Arcium MPC (using stored metaViewPriv):                                    │
│  - Iterates through on-chain positions                                       │
│  - For each position with ephemeralPub:                                     │
│    - Computes: expectedStealthPub = derive(metaSpendPub, metaViewPub, ephPub)│
│    - Checks: expectedStealthPub == position.stealthOwner?                   │
│  - Returns list of matching position pubkeys                                 │
│                                                                              │
│  Step 4: Display Positions in Dashboard                                      │
│  ══════════════════════════════════════                                      │
│  Employee sees:                                                              │
│  - Organization name                                                         │
│  - Vesting progress (computed in MPC, revealed only to owner)               │
│  - Claimable amount                                                          │
│                                                                              │
│  Step 5: Initiate Claim                                                      │
│  ══════════════════════                                                      │
│  Frontend sends claim request to Arcium MPC                                  │
│                                                                              │
│  Step 6: Arcium MPC Signing (Key Never Leaves MPC)                           │
│  ═════════════════════════════════════════════════                           │
│  Inside MPC:                                                                 │
│  - Retrieves metaSpendPriv (sharded)                                        │
│  - Derives stealthPriv = deriveStealthKeypair(metaSpendPriv, metaViewPub,   │
│                                                ephemeralPriv)               │
│  - Constructs withdrawal transaction                                         │
│  - Signs with stealthPriv                                                   │
│  - Returns ONLY the signed transaction                                       │
│                                                                              │
│  Step 7: Broadcast Transaction                                               │
│  ═════════════════════════════                                               │
│  Frontend receives signed tx, broadcasts to Solana                           │
│  Tokens transferred to employee's main wallet                                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================================
// User & Authentication
// ============================================================================

model User {
  id            String       @id @default(uuid())
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  wallets       UserWallet[]
  links         UserLink[]
  organizations Organization[]

  @@map("users")
}

model UserWallet {
  id            String    @id @default(uuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  chain         Chain     @default(SOLANA)
  address       String    @unique

  // Stealth meta keys (PUBLIC KEYS ONLY - private keys in Arcium)
  metaSpendPub  String?   // Base58 encoded Ed25519 public key
  metaViewPub   String?   // Base58 encoded Ed25519 public key

  // Reference to Arcium MPC stored private keys
  arciumKeyId   String?   @unique  // ID to retrieve keys from Arcium

  // Links associated with this wallet's stealth keys
  links         UserLink[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([userId])
  @@index([address])
  @@map("user_wallets")
}

enum Chain {
  SOLANA
  SUI
}

// ============================================================================
// Link System (kage.ink/username)
// ============================================================================

model UserLink {
  id            String     @id @default(uuid())
  userId        String
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Link identifier
  slug          String     @unique  // "alice" for kage.ink/alice

  // Display info
  label         String?    // "Alice's Vesting Account"
  description   String?

  // Which wallet's stealth keys to use for this link
  walletId      String
  wallet        UserWallet @relation(fields: [walletId], references: [id])

  // Status
  isActive      Boolean    @default(true)

  // Stats
  positionsReceived Int    @default(0)

  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  @@index([userId])
  @@index([slug])
  @@map("user_links")
}

// ============================================================================
// Organization (cached from on-chain)
// ============================================================================

model Organization {
  id            String    @id @default(uuid())

  // On-chain reference
  pubkey        String    @unique  // Organization PDA
  adminWallet   String    // Admin wallet address

  // Cached on-chain data
  nameHash      String    // Hex encoded [u8; 32]
  tokenMint     String
  treasury      String
  isActive      Boolean   @default(true)

  // Owner in our system (if registered)
  adminUserId   String?
  adminUser     User?     @relation(fields: [adminUserId], references: [id])

  // Cached stats
  scheduleCount Int       @default(0)
  positionCount Int       @default(0)

  // Schedules and positions
  schedules     VestingSchedule[]
  positions     VestingPosition[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([adminWallet])
  @@map("organizations")
}

// ============================================================================
// Vesting Schedule (cached from on-chain)
// ============================================================================

model VestingSchedule {
  id              String    @id @default(uuid())

  // On-chain reference
  pubkey          String    @unique  // Schedule PDA
  organizationId  String
  organization    Organization @relation(fields: [organizationId], references: [id])

  // Schedule parameters (cached)
  scheduleIndex   Int
  cliffDuration   BigInt    // seconds
  totalDuration   BigInt    // seconds
  vestingInterval BigInt    // seconds

  // Positions using this schedule
  positions       VestingPosition[]

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([organizationId])
  @@map("vesting_schedules")
}

// ============================================================================
// Vesting Position (cached from on-chain + ownership info)
// ============================================================================

model VestingPosition {
  id              String    @id @default(uuid())

  // On-chain reference
  pubkey          String    @unique  // Position PDA
  organizationId  String
  organization    Organization @relation(fields: [organizationId], references: [id])
  scheduleId      String
  schedule        VestingSchedule @relation(fields: [scheduleId], references: [id])

  // Stealth ownership
  stealthOwner    String    // Stealth public key (on-chain)
  ephemeralPub    String    // For deriving stealth keypair

  // Ownership resolution (set after scanning)
  ownerLinkId     String?   // Which link this position belongs to
  ownerWalletId   String?   // Resolved owner wallet

  // Encrypted data references (stored in Arcium)
  arciumAmountId  String?   // Reference to encrypted amount in Arcium

  // Cached timing data
  startTimestamp  BigInt

  // Status
  isActive        Boolean   @default(true)

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([organizationId])
  @@index([stealthOwner])
  @@index([ownerWalletId])
  @@map("vesting_positions")
}

// ============================================================================
// Audit Log
// ============================================================================

model AuditLog {
  id          String    @id @default(uuid())

  action      String    // "LINK_CREATED", "POSITION_CLAIMED", etc.
  userId      String?
  walletAddress String?

  metadata    Json?     // Additional context

  createdAt   DateTime  @default(now())

  @@index([userId])
  @@index([action])
  @@map("audit_logs")
}
```

---

## API Endpoints

### Authentication

```typescript
// POST /api/auth/connect
// Connect wallet and create/retrieve user session
{
  request: {
    walletAddress: string,
    signature: string,      // Signed message proving ownership
    message: string,        // Original message that was signed
    chain: "SOLANA" | "SUI"
  },
  response: {
    success: boolean,
    user: {
      id: string,
      wallets: UserWallet[],
      links: UserLink[]
    },
    token: string  // JWT for subsequent requests
  }
}

// GET /api/auth/me
// Get current authenticated user
{
  headers: { Authorization: "Bearer {token}" },
  response: {
    user: User,
    wallets: UserWallet[],
    links: UserLink[]
  }
}
```

### Stealth Key Management

```typescript
// POST /api/stealth/register
// Register stealth meta keys (after generating client-side)
{
  headers: { Authorization: "Bearer {token}" },
  request: {
    walletId: string,
    metaSpendPub: string,   // Base58 public key
    metaViewPub: string,    // Base58 public key
    // Private keys sent directly to Arcium, not to this endpoint
    arciumKeyId: string     // Reference returned by Arcium after storing
  },
  response: {
    success: boolean,
    wallet: UserWallet
  }
}

// GET /api/stealth/has-keys/:walletId
// Check if wallet has stealth keys registered
{
  headers: { Authorization: "Bearer {token}" },
  response: {
    hasKeys: boolean,
    metaSpendPub?: string,
    metaViewPub?: string
  }
}
```

### Link Management

```typescript
// POST /api/links/create
// Create a new link (kage.ink/username)
{
  headers: { Authorization: "Bearer {token}" },
  request: {
    slug: string,           // "alice" → kage.ink/alice
    label?: string,         // Display name
    walletId: string        // Which wallet's stealth keys to use
  },
  response: {
    success: boolean,
    link: {
      id: string,
      slug: string,
      fullUrl: string,      // "kage.ink/alice"
      metaSpendPub: string,
      metaViewPub: string
    }
  }
}

// GET /api/links/:slug
// Public endpoint - get meta-address for a link
{
  response: {
    success: boolean,
    metaAddress: {
      metaSpendPub: string,
      metaViewPub: string
    }
  }
}

// GET /api/links/my-links
// Get all links for authenticated user
{
  headers: { Authorization: "Bearer {token}" },
  response: {
    links: UserLink[]
  }
}

// PUT /api/links/:linkId
// Update link settings
{
  headers: { Authorization: "Bearer {token}" },
  request: {
    label?: string,
    isActive?: boolean
  },
  response: {
    success: boolean,
    link: UserLink
  }
}

// DELETE /api/links/:linkId
// Deactivate a link (soft delete)
{
  headers: { Authorization: "Bearer {token}" },
  response: {
    success: boolean
  }
}
```

### Position Management

```typescript
// GET /api/positions/my-positions
// Get all vesting positions for authenticated user
// (Backend scans via Arcium MPC using metaViewPriv)
{
  headers: { Authorization: "Bearer {token}" },
  response: {
    positions: [{
      id: string,
      pubkey: string,
      organization: {
        pubkey: string,
        name: string  // Decrypted if available
      },
      schedule: {
        cliffDuration: number,
        totalDuration: number,
        vestingInterval: number
      },
      startTimestamp: number,
      vestingProgress: number,     // 0-100%
      // Amounts revealed only to owner (via Arcium)
      totalAmount?: string,
      vestedAmount?: string,
      claimableAmount?: string,
      claimedAmount?: string
    }]
  }
}

// POST /api/positions/:positionId/claim
// Initiate claim (signing done in Arcium MPC)
{
  headers: { Authorization: "Bearer {token}" },
  request: {
    positionPubkey: string,
    destinationWallet: string  // Where to send claimed tokens
  },
  response: {
    success: boolean,
    signedTransaction: string,  // Base64 encoded, ready to broadcast
    estimatedAmount: string     // Claimable amount
  }
}

// POST /api/positions/scan
// Trigger a manual scan for new positions
{
  headers: { Authorization: "Bearer {token}" },
  response: {
    success: boolean,
    newPositionsFound: number,
    positions: VestingPosition[]
  }
}
```

### Organization Management

```typescript
// GET /api/organizations/mine
// Get organization where user is admin
{
  headers: { Authorization: "Bearer {token}" },
  response: {
    organization?: Organization,
    stats: {
      scheduleCount: number,
      positionCount: number,
      vaultBalance: string
    }
  }
}

// POST /api/organizations/sync
// Sync organization data from on-chain
{
  headers: { Authorization: "Bearer {token}" },
  request: {
    organizationPubkey: string
  },
  response: {
    success: boolean,
    organization: Organization
  }
}
```

---

## Arcium MPC Integration

### Key Storage

```typescript
// arcium/keyStorage.ts

interface ArciumKeyStorage {
  /**
   * Store stealth private keys in Arcium MPC
   * Keys are sharded across MPC nodes - never stored whole
   */
  storeStealthKeys(params: {
    walletAddress: string,
    walletSignature: string,  // Proves ownership
    metaSpendPriv: Uint8Array,
    metaViewPriv: Uint8Array
  }): Promise<{
    arciumKeyId: string  // Reference for retrieval
  }>;

  /**
   * Verify wallet can access keys
   * Returns true if signature valid and keys exist
   */
  verifyAccess(params: {
    arciumKeyId: string,
    walletAddress: string,
    walletSignature: string
  }): Promise<boolean>;
}
```

### Position Scanning

```typescript
// arcium/positionScanning.ts

interface ArciumPositionScanner {
  /**
   * Scan on-chain positions to find those belonging to a user
   * Computation happens inside MPC - metaViewPriv never exposed
   */
  scanPositions(params: {
    arciumKeyId: string,
    walletSignature: string,
    positionsToScan: Array<{
      pubkey: string,
      stealthOwner: string,
      ephemeralPub: string
    }>
  }): Promise<{
    ownedPositions: string[]  // Pubkeys of positions owned by this user
  }>;
}
```

### Transaction Signing

```typescript
// arcium/transactionSigning.ts

interface ArciumTransactionSigner {
  /**
   * Sign a withdrawal transaction inside MPC
   * Stealth private key never leaves MPC
   */
  signWithdrawal(params: {
    arciumKeyId: string,
    walletSignature: string,
    positionPubkey: string,
    ephemeralPub: string,
    withdrawalTransaction: Uint8Array  // Unsigned tx
  }): Promise<{
    signedTransaction: Uint8Array
  }>;
}
```

### Amount Computation

```typescript
// arcium/amountComputation.ts

interface ArciumAmountComputer {
  /**
   * Compute vesting amounts inside MPC
   * Encrypted amounts decrypted only for owner
   */
  computeVestingAmounts(params: {
    arciumKeyId: string,
    walletSignature: string,
    encryptedTotalAmount: string,  // Arcium ciphertext
    startTimestamp: number,
    currentTimestamp: number,
    cliffDuration: number,
    totalDuration: number,
    vestingInterval: number,
    claimedAmount: string
  }): Promise<{
    totalAmount: string,
    vestedAmount: string,
    claimableAmount: string
  }>;
}
```

---

## Security Considerations

### Key Security Matrix

| Key | Storage Location | Who Can Access | How Accessed |
|-----|-----------------|----------------|--------------|
| `metaSpendPriv` | Arcium MPC (sharded) | Owner only | Wallet signature + MPC computation |
| `metaSpendPub` | Backend DB | Public | API lookup by link |
| `metaViewPriv` | Arcium MPC (sharded) | Owner + Backend scanner | Wallet sig / Service auth |
| `metaViewPub` | Backend DB | Public | API lookup by link |
| `ephemeralPriv` | Employer's frontend | Employer only | Generated per position, discarded |
| `stealthPriv` | Never stored | Derived in MPC | Computed from metaSpendPriv + ephemeralPub |

### Attack Vectors & Mitigations

| Attack | Mitigation |
|--------|------------|
| Backend DB breach | Only public keys stored; private keys in Arcium |
| MPC node compromise | Threshold security - need multiple nodes |
| Replay attacks | Nonce in auth messages, short-lived tokens |
| Link enumeration | Rate limiting, CAPTCHA for lookups |
| Position correlation | Stealth addresses - each position unique |

### Authentication Flow Security

```
1. Frontend generates nonce (UUID v4)
2. Frontend creates message: "Sign to authenticate with ShadowVest\nNonce: {nonce}\nTimestamp: {iso8601}"
3. User signs with wallet
4. Backend verifies:
   - Signature valid for claimed wallet
   - Nonce not previously used (stored in Redis, 5 min TTL)
   - Timestamp within 5 minutes
5. Backend issues JWT (1 hour expiry)
6. JWT contains: userId, walletAddress, arciumKeyId
```

---

## Background Jobs

### Position Scanner Job

```typescript
// jobs/positionScanner.ts

/**
 * Runs every 5 minutes
 * Scans for new on-chain positions and matches to users
 */
async function scanNewPositions() {
  // 1. Get latest positions from Solana
  const onChainPositions = await fetchRecentPositions();

  // 2. Filter to unindexed positions
  const newPositions = await filterUnindexed(onChainPositions);

  // 3. For each user with stealth keys, check ownership via Arcium
  for (const user of usersWithStealthKeys) {
    const ownedPositions = await arcium.scanPositions({
      arciumKeyId: user.arciumKeyId,
      serviceAuth: process.env.ARCIUM_SERVICE_KEY,
      positionsToScan: newPositions
    });

    // 4. Update position ownership in DB
    await updatePositionOwnership(ownedPositions, user);
  }
}
```

### Organization Sync Job

```typescript
// jobs/organizationSync.ts

/**
 * Runs every 15 minutes
 * Syncs organization data from on-chain
 */
async function syncOrganizations() {
  const organizations = await fetchAllOrganizations();

  for (const org of organizations) {
    await prisma.organization.upsert({
      where: { pubkey: org.pubkey },
      update: {
        scheduleCount: org.scheduleCount,
        positionCount: org.positionCount,
        isActive: org.isActive
      },
      create: { ... }
    });
  }
}
```

---

## Environment Variables

```bash
# .env.example

# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/shadowvest"

# Redis (for nonce storage, caching)
REDIS_URL="redis://localhost:6379"

# Solana
SOLANA_RPC_URL="https://api.devnet.solana.com"
KAGE_PROGRAM_ID="3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA"

# JWT
JWT_SECRET="your-jwt-secret"
JWT_EXPIRY="1h"

# App
APP_URL="https://kage.ink"
PORT=3000
```

---

## Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── index.ts                 # Entry point
│   ├── app.ts                   # Fastify app setup
│   ├── config/
│   │   └── index.ts             # Environment config
│   ├── routes/
│   │   ├── auth.ts              # Authentication routes
│   │   ├── links.ts             # Link management routes
│   │   ├── positions.ts         # Position routes
│   │   ├── organizations.ts     # Organization routes
│   │   └── stealth.ts           # Stealth key routes
│   ├── middlewares/
│   │   ├── auth.ts              # JWT verification
│   │   └── rateLimit.ts         # Rate limiting
│   ├── services/
│   │   ├── arcium/
│   │   │   ├── keyStorage.ts    # Arcium key storage
│   │   │   ├── scanner.ts       # Position scanning
│   │   │   ├── signer.ts        # Transaction signing
│   │   │   └── compute.ts       # Amount computation
│   │   ├── solana/
│   │   │   ├── program.ts       # ShadowVest program client
│   │   │   └── scanner.ts       # On-chain position scanner
│   │   └── auth/
│   │       └── wallet.ts        # Wallet signature verification
│   ├── jobs/
│   │   ├── positionScanner.ts   # Background position scanner
│   │   └── organizationSync.ts  # Org data sync
│   ├── lib/
│   │   ├── prisma.ts            # Prisma client
│   │   ├── redis.ts             # Redis client
│   │   └── stealth.ts           # Stealth address utilities
│   └── utils/
│       ├── validation.ts        # Input validation
│       └── errors.ts            # Error handling
├── docs/
│   └── ARCHITECTURE.md          # This file
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Implementation Phases

### Phase 1: Core Backend (Week 1)
- [ ] Project setup (Fastify, Prisma, TypeScript)
- [ ] Database schema & migrations
- [ ] Wallet authentication (signature verification)
- [ ] Basic user/wallet CRUD

### Phase 2: Link System (Week 1-2)
- [ ] Link creation & validation
- [ ] Public meta-address lookup API
- [ ] Link management UI integration

### Phase 3: Arcium Integration (Week 2-3)
- [ ] Arcium SDK integration
- [ ] Key storage implementation
- [ ] Position scanning implementation
- [ ] Transaction signing implementation

### Phase 4: Position Management (Week 3-4)
- [ ] On-chain position indexer
- [ ] Background scanning job
- [ ] Position ownership resolution
- [ ] Claiming flow

### Phase 5: Polish & Security (Week 4)
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Error handling
- [ ] Documentation

---

## References

- [Arcium MPC Documentation](https://docs.arcium.com)
- [Light Protocol Documentation](https://docs.lightprotocol.com)
- [EIP-5564 Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [ShadowVest Contract](../contract/)
