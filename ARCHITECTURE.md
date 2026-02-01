# ShadowVest Architecture Plan

## Privacy-First Payroll & Vesting Protocol on Solana

---

## Quick Reference Links

| Technology | Main Docs | GitHub | API/SDK |
|------------|-----------|--------|---------|
| **Light Protocol** | [zkcompression.com](https://www.zkcompression.com) | [GitHub](https://github.com/Lightprotocol/light-protocol) | [Client Guide](https://www.zkcompression.com/client-library/client-guide) |
| **Arcium MPC** | [docs.arcium.com](https://docs.arcium.com) | [Examples](https://github.com/arcium-hq/examples) | [Arcis Framework](https://docs.arcium.com/developers/arcis) |
| **Noir ZK** | [noir-lang.org/docs](https://noir-lang.org/docs/) | [GitHub](https://github.com/noir-lang/noir) | [NoirJS](https://noir-lang.org/docs/tutorials/noirjs_app) |
| **Stealth Addresses** | [EIP-5564](https://eips.ethereum.org/EIPS/eip-5564) | [Zera SDK](https://github.com/jskoiz/zeraprivacy) | [@noble/curves](https://github.com/paulmillr/noble-curves) |
| **Circle CCTP** | [developers.circle.com/cctp](https://developers.circle.com/cctp) | [Solana Contracts](https://github.com/circlefin/solana-cctp-contracts) | [CCTP Guide](https://developers.circle.com/stablecoins/cctp-getting-started) |
| **USDC** | [circle.com/usdc](https://www.circle.com/usdc) | [Token Program](https://spl.solana.com/token) | [Solana: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v](https://solscan.io/token/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) |
| **Anchor** | [anchor-lang.com](https://www.anchor-lang.com) | [GitHub](https://github.com/coral-xyz/anchor) | [Rust Docs](https://docs.rs/anchor-lang/latest/anchor_lang/) |
| **Solana** | [solana.com/docs](https://solana.com/docs) | [GitHub](https://github.com/solana-labs/solana) | [Web3.js](https://solana-labs.github.io/solana-web3.js/) |

---

## Executive Summary

ShadowVest is a privacy-preserving payroll and vesting protocol that combines five complementary technologies:

| Layer | Technology | Purpose | Docs |
|-------|------------|---------|------|
| **L0** | USDC + Circle CCTP | Cross-chain payments (native USDC, no wrapped tokens) | [CCTP Docs](https://developers.circle.com/cctp) |
| **L1** | Light Protocol | Compressed state & tokens (400-5000x cost reduction) | [Docs](https://www.zkcompression.com) |
| **L2** | Arcium MPC | Confidential computation (encrypted vesting amounts) | [Docs](https://docs.arcium.com) |
| **L3** | Noir ZK Circuits | Zero-knowledge proof verification (claim eligibility) | [Docs](https://noir-lang.org/docs/) |
| **L4** | ECDH Stealth Addresses | One-time receiver addresses (receiver privacy) | [EIP-5564](https://eips.ethereum.org/EIPS/eip-5564) |

### Why USDC?

ShadowVest uses **USDC** as the primary payment token because:
- **Stable value** - Employees receive predictable salary amounts
- **Cross-chain native** - CCTP enables transfers to 9+ chains without wrapped tokens
- **Widely supported** - Accepted by exchanges, DeFi, and merchants globally
- **Compressible** - Works with Light Protocol for 400x cheaper distribution

---

## 1. System Overview

### 1.1 Core Use Cases

1. **Private Payroll**: Employers pay employees without revealing salaries on-chain
2. **Confidential Vesting**: Token vesting schedules remain private
3. **Anonymous Withdrawals**: Employees claim tokens without linking to employer
4. **Compliance Proofs**: Prove vesting eligibility without revealing amounts

### 1.2 Actors

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Employer  │     │  Employee   │     │   Auditor   │
│  (Creator)  │     │ (Recipient) │     │  (Verifier) │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌───────────────────────────────────────────────────────────┐
│                   ShadowVest Protocol                      │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    USDC + CCTP                       │  │
│  │         (Cross-chain: ETH, Base, Arb, Sol...)       │  │
│  └─────────────────────────┬───────────────────────────┘  │
│                            ▼                               │
│  ┌──────────┐  ┌──────────┐  ┌──────┐  ┌─────────────┐   │
│  │  Light   │  │  Arcium  │  │ Noir │  │   Stealth   │   │
│  │ Protocol │◄─┤   MPC    │◄─┤  ZK  │◄─┤  Addresses  │   │
│  │(compress)│  │(compute) │  │(proof)│  │  (privacy)  │   │
│  └──────────┘  └──────────┘  └──────┘  └─────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### 1.3 Cross-Chain Payroll Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SHADOWVEST CROSS-CHAIN PAYROLL                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  DEPOSIT (Employer can fund from any CCTP-supported chain)              │
│                                                                         │
│  Ethereum ──┐                                                           │
│  Base ──────┼──► CCTP ──► Solana USDC ──► Light Protocol ──► Compress   │
│  Arbitrum ──┘    (burn)    (mint)         (token pool)       (c-USDC)   │
│                                                                         │
│  VESTING (Privacy-preserving on Solana)                                 │
│                                                                         │
│  c-USDC ──► Arcium MPC ──► Encrypted Vesting ──► ZK Proofs              │
│             (amounts hidden)  (positions)        (eligibility)          │
│                                                                         │
│  WITHDRAWAL (Employee chooses destination chain)                        │
│                                                                         │
│  Claim ──► Decompress ──► USDC ──► CCTP ──┬──► Ethereum USDC            │
│            (c-USDC→USDC)         (burn)   ├──► Base USDC                │
│                                           ├──► Arbitrum USDC            │
│                                           ├──► Polygon USDC             │
│                                           └──► Stay on Solana           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer 0: USDC + Circle CCTP - Cross-Chain Payments

> **Documentation Links:**
> - [Circle CCTP Documentation](https://developers.circle.com/cctp) - Main CCTP docs
> - [CCTP Getting Started](https://developers.circle.com/stablecoins/cctp-getting-started) - Integration guide
> - [Solana CCTP Contracts](https://github.com/circlefin/solana-cctp-contracts) - Official contracts
> - [USDC on Solana](https://solscan.io/token/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) - Token explorer
> - [Circle Developer Console](https://console.circle.com/) - API access

### 2.0.1 Overview

Circle's Cross-Chain Transfer Protocol (CCTP) enables **native USDC transfers** between blockchains without wrapped tokens or liquidity pools. USDC is burned on the source chain and minted on the destination chain.

### 2.0.2 Why USDC for Payroll?

| Benefit | Description |
|---------|-------------|
| **Stable Value** | Employees receive predictable salary amounts (1 USDC = $1) |
| **No Wrapped Tokens** | Native USDC on every chain, not bridged/wrapped versions |
| **Global Liquidity** | Accepted by all major exchanges, DeFi protocols, and merchants |
| **Regulatory Clarity** | Circle is a regulated financial institution |
| **Cross-Chain Freedom** | Employees can receive salary on their preferred chain |

### 2.0.3 CCTP Supported Chains

| Chain | Domain ID | Status |
|-------|-----------|--------|
| Ethereum | 0 | Live |
| Avalanche | 1 | Live |
| Optimism | 2 | Live |
| Arbitrum | 3 | Live |
| Base | 6 | Live |
| Polygon PoS | 7 | Live |
| **Solana** | 5 | **Live** |
| Noble (Cosmos) | 4 | Live |
| Sui | 8 | Live |

### 2.0.4 USDC Contract Addresses

| Network | Address | Decimals |
|---------|---------|----------|
| **Solana Mainnet** | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 |
| **Solana Devnet** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | 6 |
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |

### 2.0.5 CCTP Program Addresses (Solana)

| Program | V1 Address | V2 Address |
|---------|------------|------------|
| **MessageTransmitter** | `CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd` | `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC` |
| **TokenMessengerMinter** | `CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3` | `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe` |

### 2.0.6 CCTP Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CCTP TRANSFER FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SOURCE CHAIN (e.g., Ethereum)                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 1. User calls depositForBurn(amount, destinationDomain, recipient)│   │
│  │ 2. USDC is burned on source chain                                │   │
│  │ 3. MessageTransmitter emits Message event                        │   │
│  └─────────────────────────────────────┬───────────────────────────┘   │
│                                        │                                │
│  CIRCLE ATTESTATION SERVICE            │                                │
│  ┌─────────────────────────────────────▼───────────────────────────┐   │
│  │ 4. Circle's attestation service observes burn                    │   │
│  │ 5. Generates signed attestation (proof of burn)                  │   │
│  │ 6. Attestation available via API                                 │   │
│  └─────────────────────────────────────┬───────────────────────────┘   │
│                                        │                                │
│  DESTINATION CHAIN (e.g., Solana)      │                                │
│  ┌─────────────────────────────────────▼───────────────────────────┐   │
│  │ 7. Relayer/User calls receiveMessage(message, attestation)       │   │
│  │ 8. MessageTransmitter verifies attestation                       │   │
│  │ 9. TokenMessengerMinter mints USDC to recipient                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.0.7 ShadowVest CCTP Integration

```typescript
// lib/cctp-bridge.ts

import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";

/**
 * CCTP Program IDs on Solana (V2)
 */
export const CCTP_PROGRAMS = {
  MESSAGE_TRANSMITTER: new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"),
  TOKEN_MESSENGER_MINTER: new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"),
};

/**
 * USDC Mint addresses
 */
export const USDC_MINT = {
  MAINNET: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  DEVNET: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
};

/**
 * CCTP Domain IDs
 */
export const CCTP_DOMAINS = {
  ETHEREUM: 0,
  AVALANCHE: 1,
  OPTIMISM: 2,
  ARBITRUM: 3,
  NOBLE: 4,
  SOLANA: 5,
  BASE: 6,
  POLYGON: 7,
};

/**
 * Initiate cross-chain USDC transfer from Solana
 * Burns USDC on Solana, to be minted on destination chain
 */
export async function bridgeUsdcFromSolana(
  connection: Connection,
  payer: Keypair,
  amount: bigint,
  destinationDomain: number,
  destinationRecipient: Uint8Array // 32-byte address on destination chain
): Promise<string> {
  // Implementation would use CCTP SDK
  // 1. Call depositForBurn on TokenMessengerMinter
  // 2. Return message hash for tracking
  throw new Error("Implement using @circlefin/cctp-sdk");
}

/**
 * Complete cross-chain USDC transfer to Solana
 * Mints USDC on Solana after burn on source chain
 */
export async function receiveUsdcOnSolana(
  connection: Connection,
  payer: Keypair,
  message: Uint8Array,
  attestation: Uint8Array
): Promise<string> {
  // Implementation would use CCTP SDK
  // 1. Call receiveMessage on MessageTransmitter
  // 2. USDC is minted to recipient
  throw new Error("Implement using @circlefin/cctp-sdk");
}
```

### 2.0.8 Employee Withdrawal Options

When an employee claims vested tokens, they can choose their destination:

| Option | Flow | Use Case |
|--------|------|----------|
| **Stay on Solana** | Decompress c-USDC → USDC | Use in Solana DeFi, low fees |
| **Bridge to Ethereum** | USDC → CCTP → ETH USDC | CEX deposits, Ethereum DeFi |
| **Bridge to Base** | USDC → CCTP → Base USDC | Low-cost L2, Coinbase ecosystem |
| **Bridge to Arbitrum** | USDC → CCTP → Arb USDC | Arbitrum DeFi ecosystem |

### 2.0.9 Cost Comparison

| Method | Per-Transfer Cost | Cross-Chain? |
|--------|-------------------|--------------|
| Traditional wire | $25-50 | Yes (slow) |
| Regular USDC transfer | ~$0.01 | No |
| Compressed USDC (Light) | ~$0.000025 | No |
| CCTP bridge | ~$0.10-0.50 | Yes (native) |
| **ShadowVest (Compressed + CCTP)** | ~$0.10-0.50 | **Yes** |

### 2.0.10 Integration with Light Protocol

USDC can be compressed for cheap on-chain distribution:

```
┌────────────────────────────────────────────────────────────────────┐
│                 USDC + LIGHT PROTOCOL INTEGRATION                   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. Create Token Pool for USDC (one-time setup)                    │
│     ┌──────────────────────────────────────────────────────────┐  │
│     │ await createTokenPool(connection, payer, USDC_MINT);      │  │
│     │ // No mint authority needed - permissionless              │  │
│     └──────────────────────────────────────────────────────────┘  │
│                                                                    │
│  2. Compress USDC for distribution                                 │
│     ┌──────────────────────────────────────────────────────────┐  │
│     │ // Lock USDC in pool, create compressed accounts         │  │
│     │ await CompressedTokenProgram.compress({                   │  │
│     │   mint: USDC_MINT,                                        │  │
│     │   amount: 1_000_000n, // 1 USDC (6 decimals)             │  │
│     │   toAddress: employeeWallet,                              │  │
│     │ });                                                       │  │
│     └──────────────────────────────────────────────────────────┘  │
│                                                                    │
│  3. Employee decompresses when ready                               │
│     ┌──────────────────────────────────────────────────────────┐  │
│     │ // Release USDC from pool to regular SPL account         │  │
│     │ await CompressedTokenProgram.decompress({                 │  │
│     │   mint: USDC_MINT,                                        │  │
│     │   amount: 1_000_000n,                                     │  │
│     │   toAddress: employeeAta,                                 │  │
│     │ });                                                       │  │
│     └──────────────────────────────────────────────────────────┘  │
│                                                                    │
│  4. Optionally bridge to another chain via CCTP                    │
│     ┌──────────────────────────────────────────────────────────┐  │
│     │ await bridgeUsdcFromSolana(                               │  │
│     │   connection, employee,                                   │  │
│     │   1_000_000n,                                             │  │
│     │   CCTP_DOMAINS.ETHEREUM,                                  │  │
│     │   ethereumRecipientAddress                                │  │
│     │ );                                                        │  │
│     └──────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Layer 1: Light Protocol - ZK Compression

> **Documentation Links:**
> - [Light Protocol Docs](https://www.zkcompression.com) - Main documentation
> - [Compressed Account Model](https://www.zkcompression.com/learn/core-concepts/compressed-account-model) - How compression works
> - [Compressed Tokens Overview](https://www.zkcompression.com/compressed-tokens/overview) - Token compression
> - [Airdrop/Distribution Guide](https://www.zkcompression.com/compressed-tokens/advanced-guides/airdrop) - Batch distribution
> - [Create Compressed Accounts](https://www.zkcompression.com/compressed-pdas/guides/how-to-create-compressed-accounts) - Implementation guide
> - [Merkle Trees & Validity Proofs](https://www.zkcompression.com/learn/core-concepts/merkle-trees-validity-proofs) - Core concepts
> - [Light SDK Client Guide](https://www.zkcompression.com/client-library/client-guide) - Client integration
> - [GitHub: light-protocol](https://github.com/Lightprotocol/light-protocol) - Source code
> - [GitHub: example-token-distribution](https://github.com/Lightprotocol/example-token-distribution) - Distribution examples

### 2.1 Overview: Two Light Protocol Features

Light Protocol provides **two distinct features** for ShadowVest:

| Feature | Use Case | Cost Savings | Implementation |
|---------|----------|--------------|----------------|
| **Compressed PDAs** | Store vesting position state | 5000x cheaper state storage | On-chain CPI |
| **Compressed Tokens** | Distribute payroll tokens | 400x cheaper token accounts | Client-side SDK |

**Why both?**
- **Compressed PDAs** = Store encrypted vesting data (position details, amounts, schedules)
- **Compressed Tokens** = Distribute actual salary payments to recipients (rent-free)

### 2.2 Approach A: Compressed Vesting Positions (State Storage)

**Purpose**: Store vesting positions as compressed accounts to achieve:
- **5000x cost reduction** vs regular Solana accounts
- **Merkle tree commitments** instead of full on-chain data
- **Scalability** to millions of vesting positions

#### Compressed Account Schema

```rust
/// Compressed Vesting Position (stored in Merkle tree)
pub struct CompressedVestingPosition {
    /// Unique identifier (32 bytes)
    pub position_id: [u8; 32],

    /// Commitment to beneficiary identity (Pedersen commitment)
    pub beneficiary_commitment: [u8; 32],

    /// Encrypted total vesting amount (Arcium ciphertext)
    pub encrypted_total_amount: [u8; 64],

    /// Encrypted vested amount (Arcium ciphertext)
    pub encrypted_vested_amount: [u8; 64],

    /// Vesting start timestamp
    pub start_timestamp: i64,

    /// Cliff duration in seconds
    pub cliff_duration: u64,

    /// Total vesting duration in seconds
    pub total_duration: u64,

    /// Token mint address
    pub token_mint: Pubkey,

    /// Nullifier (prevents double-spend)
    pub nullifier_hash: [u8; 32],
}
```

#### Light Protocol Integration (On-Chain CPI)

```rust
// programs/shadowvest/src/light_integration.rs

use light_sdk::{
    compressed_account::{CompressedAccount, CompressedAccountData},
    merkle_context::MerkleContext,
    proof::CompressedProof,
};

/// Create a new compressed vesting position
pub fn create_compressed_vesting(
    ctx: Context<CreateVesting>,
    merkle_context: MerkleContext,
    encrypted_amount: [u8; 64],
    beneficiary_commitment: [u8; 32],
    cliff_duration: u64,
    total_duration: u64,
) -> Result<()> {
    // 1. Build compressed account data
    let position = CompressedVestingPosition {
        position_id: generate_position_id(&ctx),
        beneficiary_commitment,
        encrypted_total_amount: encrypted_amount,
        encrypted_vested_amount: [0u8; 64], // Initially zero
        start_timestamp: Clock::get()?.unix_timestamp,
        cliff_duration,
        total_duration,
        token_mint: ctx.accounts.token_mint.key(),
        nullifier_hash: [0u8; 32],
    };

    // 2. Append to Merkle tree via Light Protocol
    light_sdk::compress_account(
        &ctx.accounts.merkle_tree,
        &position,
        merkle_context,
    )?;

    Ok(())
}
```

#### State Tree Structure

```
Merkle Tree (State Root)
        │
   ┌────┴────┐
   │         │
 ┌─┴─┐     ┌─┴─┐
 │   │     │   │
Pos1 Pos2  Pos3 Pos4  (Compressed Vesting Positions)
```

### 2.3 Approach B: Compressed Token Distribution (Payroll)

**Purpose**: Distribute salary payments as compressed tokens to achieve:
- **400x cost reduction** vs regular SPL token accounts (~2M lamports → ~5K lamports)
- **Rent-free token accounts** - recipients don't pay rent
- **Batch distribution** - pay 10,000+ employees in optimized transactions
- **Seamless interoperability** - recipients can decompress to regular SPL tokens

#### Why Compressed Tokens for Payroll?

| Traditional SPL Distribution | Compressed Token Distribution |
|------------------------------|-------------------------------|
| ~2,000,000 lamports per recipient account | ~5,000 lamports per recipient |
| Rent required (locked capital) | Rent-free (no locked capital) |
| One transaction per recipient | Batch multiple recipients per tx |
| High gas for large payrolls | Optimized compute per batch |

**Example**: Paying 1,000 employees monthly
- **Traditional**: 2,000,000 × 1,000 = 2 SOL in rent deposits
- **Compressed**: 5,000 × 1,000 = 0.005 SOL total cost (400x cheaper)

#### Architecture: Compressed Payroll Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                COMPRESSED PAYROLL DISTRIBUTION                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Employer deposits SPL tokens to Token Pool                  │
│     ┌────────────┐     deposit      ┌─────────────┐            │
│     │  Employer  │─────────────────►│ Token Pool  │            │
│     │  Wallet    │                  │ (SPL Lock)  │            │
│     └────────────┘                  └──────┬──────┘            │
│                                            │                    │
│  2. Compress & distribute to recipients    │                    │
│                                            ▼                    │
│     ┌──────────────────────────────────────────────────────┐   │
│     │            Compression Instructions                   │   │
│     │  CompressedTokenProgram.compress(recipients[])       │   │
│     │  - Batched: 5 recipients per instruction             │   │
│     │  - Optimized: 500K compute units per batch           │   │
│     └──────────────────────────┬───────────────────────────┘   │
│                                │                                │
│  3. Recipients receive compressed tokens                        │
│                                ▼                                │
│     ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │
│     │ Emp 1  │  │ Emp 2  │  │ Emp 3  │  │ Emp N  │           │
│     │(c-tok) │  │(c-tok) │  │(c-tok) │  │(c-tok) │           │
│     └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘           │
│         │           │           │           │                  │
│  4. Recipients can decompress anytime                          │
│         ▼           ▼           ▼           ▼                  │
│     ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │
│     │Regular │  │Regular │  │Regular │  │Regular │           │
│     │SPL Tok │  │SPL Tok │  │SPL Tok │  │SPL Tok │           │
│     └────────┘  └────────┘  └────────┘  └────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Implementation: Client-Side Distribution

```typescript
// lib/compressed-payroll.ts

import { createRpc } from "@lightprotocol/stateless.js";
import { CompressedTokenProgram } from "@lightprotocol/compressed-token";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

/**
 * Payroll distribution configuration
 */
interface PayrollConfig {
  mint: PublicKey;              // Token mint address
  recipients: PayrollRecipient[];
  batchSize?: number;           // Recipients per instruction (default: 5)
  computeUnitsPerRecipient?: number; // ~120,000 CU per recipient
}

interface PayrollRecipient {
  address: PublicKey;
  amount: bigint;  // Token amount in base units
}

/**
 * Distribute payroll using compressed tokens
 */
export async function distributePayroll(
  connection: Connection,
  payer: Keypair,
  config: PayrollConfig
): Promise<{ successful: number; failed: number; signatures: string[] }> {
  const { mint, recipients, batchSize = 5 } = config;

  // 1. Get Light Protocol infrastructure
  const rpc = createRpc(connection.rpcEndpoint);
  const stateTreeInfos = await rpc.getStateTreeInfos();
  const tokenPoolInfos = await getTokenPoolInfos(rpc, mint);

  // 2. Create batched compression instructions
  const batches = chunkArray(recipients, batchSize);
  const results = { successful: 0, failed: 0, signatures: [] as string[] };

  for (const batch of batches) {
    try {
      // Build compression instruction for batch
      const ix = await CompressedTokenProgram.compress({
        payer: payer.publicKey,
        mint,
        recipients: batch.map(r => ({
          address: r.address,
          amount: r.amount,
        })),
        stateTree: selectStateTreeInfo(stateTreeInfos),
        tokenPool: selectTokenPoolInfo(tokenPoolInfos),
      });

      // Add compute budget (120K per recipient)
      const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: batch.length * 120_000,
      });

      // Send transaction
      const tx = new Transaction().add(computeIx, ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

      results.successful += batch.length;
      results.signatures.push(sig);
    } catch (error) {
      console.error(`Batch failed:`, error);
      results.failed += batch.length;
    }
  }

  return results;
}

/**
 * Employee decompresses tokens to regular SPL
 */
export async function decompressTokens(
  connection: Connection,
  owner: Keypair,
  mint: PublicKey,
  amount: bigint
): Promise<string> {
  const rpc = createRpc(connection.rpcEndpoint);

  // Get validity proof for decompression
  const compressedAccounts = await rpc.getCompressedTokenAccountsByOwner(
    owner.publicKey,
    { mint }
  );

  const ix = await CompressedTokenProgram.decompress({
    payer: owner.publicKey,
    owner: owner.publicKey,
    mint,
    amount,
    compressedAccounts,
  });

  const tx = new Transaction().add(ix);
  return await sendAndConfirmTransaction(connection, tx, [owner]);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}
```

#### Integration with ShadowVest Vesting

The compressed token distribution integrates with the existing vesting system:

```
┌────────────────────────────────────────────────────────────────┐
│              VESTING + COMPRESSED DISTRIBUTION                  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  VESTING LAYER (Arcium MPC + Light PDAs)                       │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ VestingPosition {                                         │ │
│  │   encrypted_total_amount,     // Arcium encrypted        │ │
│  │   encrypted_claimed_amount,   // Arcium encrypted        │ │
│  │   vesting_schedule,           // Public params           │ │
│  │ }                                                         │ │
│  │ → Stored as Compressed PDA (5000x cheaper)                │ │
│  └──────────────────────────────────────────────────────────┘ │
│                         │                                      │
│                         │ claim_vested_tokens()                │
│                         ▼                                      │
│  DISTRIBUTION LAYER (Compressed Tokens)                        │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 1. Arcium MPC calculates claimable amount                 │ │
│  │ 2. ZK proof verifies claim eligibility                    │ │
│  │ 3. Tokens distributed as compressed tokens (400x cheaper) │ │
│  │ 4. Recipient can decompress to regular SPL anytime        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

#### Dependencies for Token Distribution

```json
// package.json
{
  "dependencies": {
    "@lightprotocol/stateless.js": ">=0.21.0",
    "@lightprotocol/compressed-token": ">=0.21.0",
    "@solana/web3.js": "^1.95.0",
    "@solana/spl-token": "^0.4.0"
  }
}
```

### 2.4 Decision: When to Use Each Approach

| Scenario | Use Compressed PDAs | Use Compressed Tokens |
|----------|--------------------|-----------------------|
| Store vesting position details | ✅ Yes | ❌ No |
| Distribute salary payments | ❌ No | ✅ Yes |
| Track encrypted amounts | ✅ Yes (with Arcium) | ❌ No |
| Batch pay 1000+ employees | ❌ No | ✅ Yes |
| Recipient needs SPL tokens | ❌ No | ✅ Yes (can decompress) |

**Recommended Architecture**:
1. **Phase 2a**: Use Compressed PDAs for vesting position state storage
2. **Phase 2b**: Use Compressed Tokens for actual payroll distribution

---

## 3. Layer 2: Arcium MPC - Confidential Execution

> **Documentation Links:**
> - [Arcium Documentation](https://docs.arcium.com) - Main documentation
> - [Arcium Developers Guide](https://docs.arcium.com/developers) - Getting started
> - [Arcis Framework](https://docs.arcium.com/developers/arcis) - Rust MPC circuits
> - [Computation Lifecycle](https://docs.arcium.com/developers/computation-lifecycle) - How computations work
> - [Encryption & Sealing](https://docs.arcium.com/developers/encryption) - X25519 encryption
> - [JavaScript Client](https://docs.arcium.com/developers/javascript-client) - Client SDK
> - [GitHub: arcium-hq/examples](https://github.com/arcium-hq/examples) - Example projects (voting, games, medical)

### 3.1 Purpose

Perform encrypted calculations on vesting data without revealing:
- Individual salary amounts
- Total company payroll
- Vesting progress percentages

### 3.2 Encrypted Instructions (Arcis Framework)

```rust
// encrypted-ixs/src/vesting.rs

use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    /// Input for vesting calculation
    pub struct VestingInput {
        /// Total vesting amount (encrypted)
        pub total_amount: u64,
        /// Start timestamp
        pub start_time: i64,
        /// Cliff duration
        pub cliff_duration: u64,
        /// Total duration
        pub total_duration: u64,
        /// Current timestamp
        pub current_time: i64,
    }

    /// Output from vesting calculation
    pub struct VestingOutput {
        /// Amount currently vested (encrypted)
        pub vested_amount: u64,
        /// Amount available to claim (encrypted)
        pub claimable_amount: u64,
        /// Is cliff passed (boolean as u8)
        pub cliff_passed: u8,
    }

    /// Calculate vested amount (confidential computation)
    #[instruction]
    pub fn calculate_vested_amount(
        input_ctxt: Enc<Shared, VestingInput>
    ) -> Enc<Shared, VestingOutput> {
        let input = input_ctxt.to_arcis();

        // Calculate elapsed time
        let elapsed = if input.current_time > input.start_time {
            (input.current_time - input.start_time) as u64
        } else {
            0u64
        };

        // Check if cliff has passed
        let cliff_passed = if elapsed >= input.cliff_duration { 1u8 } else { 0u8 };

        // Calculate vested amount (linear vesting after cliff)
        let vested_amount = if cliff_passed == 1 {
            let vesting_elapsed = elapsed - input.cliff_duration;
            let vesting_duration = input.total_duration - input.cliff_duration;

            if vesting_elapsed >= vesting_duration {
                input.total_amount
            } else {
                (input.total_amount * vesting_elapsed) / vesting_duration
            }
        } else {
            0u64
        };

        let output = VestingOutput {
            vested_amount,
            claimable_amount: vested_amount, // Simplified - would subtract already claimed
            cliff_passed,
        };

        input_ctxt.owner.from_arcis(output)
    }

    /// Aggregate payroll without revealing individual amounts
    #[instruction]
    pub fn aggregate_payroll(
        inputs: Enc<Shared, Vec<u64>>
    ) -> Enc<Shared, u64> {
        let amounts = inputs.to_arcis();
        let total: u64 = amounts.iter().sum();
        inputs.owner.from_arcis(total)
    }

    /// Compare if claimable amount >= requested withdrawal
    #[instruction]
    pub fn verify_withdrawal_eligible(
        input_ctxt: Enc<Shared, WithdrawalCheck>
    ) -> Enc<Shared, u8> {
        let input = input_ctxt.to_arcis();
        let eligible = if input.claimable >= input.requested { 1u8 } else { 0u8 };
        input_ctxt.owner.from_arcis(eligible)
    }
}
```

### 3.3 Arcium Program Integration

```rust
// programs/shadowvest/src/lib.rs

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

declare_id!("ShadowVest111111111111111111111111111111111");

const COMP_DEF_VESTING: u32 = comp_def_offset("calculate_vested_amount");
const COMP_DEF_WITHDRAWAL: u32 = comp_def_offset("verify_withdrawal_eligible");

#[arcium_program]
pub mod shadowvest {
    use super::*;

    /// Initialize computation definition for vesting calculations
    pub fn init_vesting_comp_def(ctx: Context<InitVestingCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Queue a confidential vesting calculation
    pub fn calculate_vesting(
        ctx: Context<CalculateVesting>,
        computation_offset: u64,
        encrypted_total: [u8; 64],
        encrypted_times: [u8; 64],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_bytes(encrypted_total)
            .encrypted_bytes(encrypted_times)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![VestingCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[]
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback when vesting calculation completes
    #[arcium_callback(encrypted_ix = "calculate_vested_amount")]
    pub fn vesting_callback(
        ctx: Context<VestingCallback>,
        output: SignedComputationOutputs<VestingOutput>,
    ) -> Result<()> {
        let result = output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account
        ).map_err(|_| ErrorCode::ComputationFailed)?;

        // Emit event with encrypted result
        emit!(VestingCalculated {
            position_id: ctx.accounts.position.position_id,
            encrypted_vested: result.field_0.ciphertexts[0],
            encrypted_claimable: result.field_0.ciphertexts[1],
            nonce: result.field_0.nonce.to_le_bytes(),
        });

        Ok(())
    }
}
```

### 3.4 MPC Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    ARCIUM MPC FLOW                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Client encrypts data with X25519                         │
│     ┌─────────┐                                              │
│     │ User    │──encrypt──►[Encrypted Vesting Data]          │
│     └─────────┘                                              │
│                                                              │
│  2. Submit to Solana program                                 │
│     [Encrypted Data]──►┌────────────────┐                    │
│                        │ ShadowVest     │                    │
│                        │ Program        │                    │
│                        └───────┬────────┘                    │
│                                │                             │
│  3. Queue computation to Arcium network                      │
│                                ▼                             │
│                        ┌────────────────┐                    │
│                        │ Arcium MXE     │                    │
│                        │ (MPC Nodes)    │                    │
│                        └───────┬────────┘                    │
│                                │                             │
│  4. MPC nodes compute on encrypted data                      │
│     Node1 ◄──secret share──► Node2                           │
│       │                        │                             │
│       └───────┬────────────────┘                             │
│               ▼                                              │
│     [Encrypted Result]                                       │
│                                                              │
│  5. Callback delivers encrypted result                       │
│                        ┌────────────────┐                    │
│     [Result]──────────►│ Callback Ix    │──►[On-chain Event] │
│                        └────────────────┘                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Layer 3: Noir ZK Circuits - Proof Verification

> **Documentation Links:**
> - [Noir Language Docs](https://noir-lang.org/docs/) - Main documentation
> - [Quick Start Guide](https://noir-lang.org/docs/getting_started/quick_start) - Installation & first circuit
> - [NoirJS Tutorial](https://noir-lang.org/docs/tutorials/noirjs_app) - Browser proof generation
> - [Language Reference](https://noir-lang.org/docs/noir/concepts/data_types) - Data types & syntax
> - [Standard Library](https://noir-lang.org/docs/noir/standard_library) - Built-in functions (Poseidon, etc.)
> - [Barretenberg Backend](https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg) - Default proving backend
> - [GitHub: noir-lang/noir](https://github.com/noir-lang/noir) - Source code
> - [Awesome Noir](https://github.com/noir-lang/awesome-noir) - Community resources

### 4.1 Purpose

Generate and verify zero-knowledge proofs for:
- **Withdrawal eligibility** - Prove right to withdraw without revealing amount
- **Identity verification** - Prove you're the beneficiary without revealing identity
- **Compliance attestation** - Prove vesting terms met without revealing terms

### 4.2 Circuit Specifications

```noir
// circuits/withdrawal_proof/src/main.nr

// Public inputs (visible on-chain)
struct PublicInputs {
    state_root: Field,       // Merkle root of vesting state
    epoch_id: u64,           // Current epoch for time-locking
    nullifier: Field,        // Prevents double-withdrawal
    withdrawal_commitment: Field, // Commitment to withdrawal amount
}

// Private inputs (known only to prover)
struct PrivateInputs {
    vesting_amount: u64,     // Total vesting amount
    identity_secret: Field,  // Secret key for identity
    vesting_path: [Field; 32], // Merkle proof path
    claimed_amount: u64,     // Amount being claimed
}

fn main(
    // Public
    state_root: pub Field,
    epoch_id: pub u64,
    nullifier: pub Field,
    withdrawal_commitment: pub Field,
    // Private
    vesting_amount: u64,
    identity_secret: Field,
    vesting_path: [Field; 32],
    claimed_amount: u64,
) {
    // 1. Verify identity commitment matches beneficiary
    let identity_commitment = poseidon::hash([identity_secret]);

    // 2. Compute vesting position leaf
    let position_leaf = poseidon::hash([
        identity_commitment,
        vesting_amount as Field,
    ]);

    // 3. Verify Merkle proof (position exists in state tree)
    let computed_root = compute_merkle_root(position_leaf, vesting_path);
    assert(computed_root == state_root);

    // 4. Verify nullifier is correctly derived
    let expected_nullifier = poseidon::hash([identity_secret, epoch_id as Field]);
    assert(expected_nullifier == nullifier);

    // 5. Verify claimed amount <= vested amount
    // (Simplified - full version would calculate vested based on time)
    assert(claimed_amount <= vesting_amount);

    // 6. Verify withdrawal commitment
    let expected_commitment = poseidon::hash([claimed_amount as Field]);
    assert(expected_commitment == withdrawal_commitment);
}

// Helper: Compute Merkle root from leaf and path
fn compute_merkle_root(leaf: Field, path: [Field; 32]) -> Field {
    let mut current = leaf;
    for i in 0..32 {
        current = poseidon::hash([current, path[i]]);
    }
    current
}
```

### 4.3 Identity Proof Circuit

```noir
// circuits/identity_proof/src/main.nr

/// Prove beneficiary status without revealing identity
fn main(
    // Public
    position_commitment: pub Field,
    // Private
    identity_preimage: Field,
    position_data: [Field; 4],
) {
    // Hash identity to commitment
    let identity_commitment = poseidon::hash([identity_preimage]);

    // Rebuild position commitment
    let computed_commitment = poseidon::hash([
        identity_commitment,
        position_data[0], // encrypted_amount
        position_data[1], // start_time
        position_data[2], // cliff
        position_data[3], // duration
    ]);

    // Verify match
    assert(computed_commitment == position_commitment);
}
```

### 4.4 Noir Integration with Solana

```rust
// programs/shadowvest/src/noir_verifier.rs

use anchor_lang::prelude::*;

/// Verification key (generated by nargo compile)
pub const WITHDRAWAL_VK: [u8; 2048] = include_bytes!("../../../circuits/withdrawal_proof/target/vk");

/// On-chain proof verification
pub fn verify_withdrawal_proof(
    ctx: Context<VerifyWithdrawal>,
    proof: Vec<u8>,
    public_inputs: WithdrawalPublicInputs,
) -> Result<()> {
    // Serialize public inputs
    let inputs = [
        public_inputs.state_root,
        public_inputs.epoch_id.to_le_bytes().try_into().unwrap(),
        public_inputs.nullifier,
        public_inputs.withdrawal_commitment,
    ];

    // Verify using Noir's Barretenberg verifier
    let valid = noir_verifier::verify(
        &WITHDRAWAL_VK,
        &proof,
        &inputs,
    )?;

    require!(valid, ErrorCode::InvalidProof);

    // Mark nullifier as used
    ctx.accounts.nullifier_registry.mark_used(public_inputs.nullifier)?;

    Ok(())
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct WithdrawalPublicInputs {
    pub state_root: [u8; 32],
    pub epoch_id: u64,
    pub nullifier: [u8; 32],
    pub withdrawal_commitment: [u8; 32],
}
```

---

## 5. Layer 4: ECDH Stealth Addresses - Receiver Privacy

> **Documentation Links:**
> - [EIP-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564) - Ethereum stealth address standard
> - [Vitalik's Stealth Address Guide](https://vitalik.eth.limo/general/2023/01/20/stealth.html) - Conceptual explanation
> - [GhostSol/Zera Privacy SDK](https://github.com/jskoiz/zeraprivacy) - Solana stealth implementation
> - [Solana Token-2022 Confidential Transfers](https://spl.solana.com/confidential-token/deep-dive/zkps) - Native privacy
> - [@noble/curves (Ed25519)](https://github.com/paulmillr/noble-curves) - Cryptographic primitives
> - [@noble/hashes](https://github.com/paulmillr/noble-hashes) - Hash functions (SHA512)
> - [ECDH Explained](https://cryptobook.nakov.com/asymmetric-key-ciphers/ecdh-key-exchange) - Key exchange theory
> - [Umbra Protocol](https://app.umbra.cash/) - Ethereum stealth payments reference

### 5.1 Purpose

Generate one-time addresses for every payment to break on-chain linkability:
- **Receiver Privacy** - Each payment goes to a unique, unlinkable address
- **No Address Reuse** - Prevents transaction graph analysis
- **Self-Custody** - Only recipient can derive private key to spend

### 5.2 Why Stealth Addresses Are Needed

Arcium MPC hides **amounts** but not **receiver addresses**. Without stealth addresses:

```
❌ Problem: Employer → Employee Address (visible on-chain)
   Transaction 1: Company Wallet → 0xAlice... (monthly salary)
   Transaction 2: Company Wallet → 0xAlice... (monthly salary)
   Transaction 3: Company Wallet → 0xAlice... (monthly salary)

   Analysis: 0xAlice receives regular payments from Company = Employee

✅ Solution: Employer → Stealth Address (unlinkable)
   Transaction 1: Company Wallet → 0x7a3f... (stealth address 1)
   Transaction 2: Company Wallet → 0x9b2e... (stealth address 2)
   Transaction 3: Company Wallet → 0xc4d1... (stealth address 3)

   Analysis: Three unrelated addresses, no pattern visible
```

### 5.3 Stealth Address Cryptography

Based on **Elliptic Curve Diffie-Hellman (ECDH)** key agreement:

```
┌─────────────────────────────────────────────────────────────────┐
│                 STEALTH ADDRESS GENERATION                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Employee (Receiver) Setup:                                     │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  spend_key (s) = random scalar                          │    │
│  │  view_key  (v) = random scalar                          │    │
│  │  Spend_Pubkey (S) = s * G                               │    │
│  │  View_Pubkey  (V) = v * G                               │    │
│  │  Meta Address = (S, V)  ← Published once                │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Employer (Sender) generates stealth address:                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  ephemeral_key (r) = random scalar                      │    │
│  │  Ephemeral_Pubkey (R) = r * G  ← Included in tx         │    │
│  │  shared_secret = r * V = r * v * G                      │    │
│  │  stealth_pubkey = S + hash(shared_secret) * G           │    │
│  │  stealth_address = address(stealth_pubkey)              │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Employee (Receiver) derives private key:                       │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  shared_secret = v * R = v * r * G  (same as sender)    │    │
│  │  stealth_privkey = s + hash(shared_secret)              │    │
│  │  Can now spend from stealth_address!                    │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Stealth Address Implementation

```typescript
// lib/stealth-address.ts

import { ed25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { Keypair, PublicKey } from '@solana/web3.js';

/**
 * Employee's stealth meta-address (published once)
 */
export interface StealthMetaAddress {
  spendPubkey: Uint8Array;  // S = s * G
  viewPubkey: Uint8Array;   // V = v * G
}

/**
 * Employee generates their meta-address during onboarding
 */
export function generateStealthMetaAddress(): {
  metaAddress: StealthMetaAddress;
  spendKey: Uint8Array;
  viewKey: Uint8Array;
} {
  const spendKey = ed25519.utils.randomPrivateKey();
  const viewKey = ed25519.utils.randomPrivateKey();

  return {
    metaAddress: {
      spendPubkey: ed25519.getPublicKey(spendKey),
      viewPubkey: ed25519.getPublicKey(viewKey),
    },
    spendKey,
    viewKey,
  };
}

/**
 * Employer generates a one-time stealth address for payment
 */
export function generateStealthAddress(
  metaAddress: StealthMetaAddress
): {
  stealthAddress: PublicKey;
  ephemeralPubkey: Uint8Array;
} {
  // Generate ephemeral keypair
  const ephemeralKey = ed25519.utils.randomPrivateKey();
  const ephemeralPubkey = ed25519.getPublicKey(ephemeralKey);

  // ECDH: shared_secret = r * V
  const sharedSecret = ed25519.getSharedSecret(
    ephemeralKey,
    metaAddress.viewPubkey
  );

  // Derive stealth public key: S + hash(shared_secret) * G
  const hashScalar = sha512(sharedSecret).slice(0, 32);
  const hashPoint = ed25519.ExtendedPoint.BASE.multiply(
    bytesToNumberLE(hashScalar)
  );
  const spendPoint = ed25519.ExtendedPoint.fromHex(metaAddress.spendPubkey);
  const stealthPoint = spendPoint.add(hashPoint);

  // Convert to Solana address
  const stealthPubkeyBytes = stealthPoint.toRawBytes();
  const stealthAddress = new PublicKey(stealthPubkeyBytes);

  return { stealthAddress, ephemeralPubkey };
}

/**
 * Employee derives private key to spend from stealth address
 */
export function deriveStealthPrivateKey(
  spendKey: Uint8Array,
  viewKey: Uint8Array,
  ephemeralPubkey: Uint8Array
): Keypair {
  // ECDH: shared_secret = v * R (same as sender's r * V)
  const sharedSecret = ed25519.getSharedSecret(viewKey, ephemeralPubkey);

  // Derive stealth private key: s + hash(shared_secret)
  const hashScalar = sha512(sharedSecret).slice(0, 32);
  const stealthPrivkey = addScalars(spendKey, hashScalar);

  return Keypair.fromSecretKey(stealthPrivkey);
}

/**
 * Employee scans blockchain for payments to them
 */
export async function scanForStealthPayments(
  viewKey: Uint8Array,
  spendPubkey: Uint8Array,
  ephemeralPubkeys: Uint8Array[] // From on-chain events
): Promise<PublicKey[]> {
  const myAddresses: PublicKey[] = [];

  for (const ephemeralPubkey of ephemeralPubkeys) {
    // Try to derive the stealth address
    const sharedSecret = ed25519.getSharedSecret(viewKey, ephemeralPubkey);
    const hashScalar = sha512(sharedSecret).slice(0, 32);
    const hashPoint = ed25519.ExtendedPoint.BASE.multiply(
      bytesToNumberLE(hashScalar)
    );
    const spendPoint = ed25519.ExtendedPoint.fromHex(spendPubkey);
    const stealthPoint = spendPoint.add(hashPoint);

    // Check if this address has funds
    const stealthAddress = new PublicKey(stealthPoint.toRawBytes());
    // If address has balance, add to list
    myAddresses.push(stealthAddress);
  }

  return myAddresses;
}

// Helper functions
function bytesToNumberLE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result += BigInt(bytes[i]) << BigInt(8 * i);
  }
  return result;
}

function addScalars(a: Uint8Array, b: Uint8Array): Uint8Array {
  // Modular addition in ed25519 scalar field
  const aNum = bytesToNumberLE(a);
  const bNum = bytesToNumberLE(b);
  const sum = (aNum + bNum) % ed25519.CURVE.n;
  return numberToBytesLE(sum, 32);
}

function numberToBytesLE(num: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Number((num >> BigInt(8 * i)) & 0xffn);
  }
  return bytes;
}
```

### 5.5 On-Chain Stealth Registry

```rust
// programs/shadowvest/src/stealth_registry.rs

use anchor_lang::prelude::*;

/// Registry for stealth meta-addresses (one per employee)
#[account]
pub struct StealthMetaAddress {
    /// Owner who can update this meta-address
    pub owner: Pubkey,
    /// Spend public key (S)
    pub spend_pubkey: [u8; 32],
    /// View public key (V)
    pub view_pubkey: [u8; 32],
    /// Bump seed
    pub bump: u8,
}

/// Event emitted when sending to stealth address
#[event]
pub struct StealthPayment {
    /// Ephemeral public key (R) - needed for recipient to derive key
    pub ephemeral_pubkey: [u8; 32],
    /// The stealth address receiving payment
    pub stealth_address: Pubkey,
    /// Encrypted payment reference (optional)
    pub encrypted_memo: [u8; 64],
    /// Timestamp
    pub timestamp: i64,
}

/// Register employee's stealth meta-address
pub fn register_stealth_meta_address(
    ctx: Context<RegisterStealthMeta>,
    spend_pubkey: [u8; 32],
    view_pubkey: [u8; 32],
) -> Result<()> {
    let meta = &mut ctx.accounts.stealth_meta;
    meta.owner = ctx.accounts.owner.key();
    meta.spend_pubkey = spend_pubkey;
    meta.view_pubkey = view_pubkey;
    meta.bump = ctx.bumps.stealth_meta;
    Ok(())
}

/// Pay to stealth address (called by employer)
pub fn pay_to_stealth(
    ctx: Context<PayToStealth>,
    ephemeral_pubkey: [u8; 32],
    stealth_address: Pubkey,
    amount: u64,
    encrypted_memo: [u8; 64],
) -> Result<()> {
    // Transfer tokens to stealth address
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vesting_vault.to_account_info(),
            to: ctx.accounts.stealth_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        &[&[b"vault_authority", &[ctx.bumps.vault_authority]]],
    );
    token::transfer(transfer_ctx, amount)?;

    // Emit event for recipient to scan
    emit!(StealthPayment {
        ephemeral_pubkey,
        stealth_address,
        encrypted_memo,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterStealthMeta<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 32 + 1,
        seeds = [b"stealth_meta", owner.key().as_ref()],
        bump,
    )]
    pub stealth_meta: Account<'info, StealthMetaAddress>,

    pub system_program: Program<'info, System>,
}
```

### 5.6 Stealth Address Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                  STEALTH PAYROLL FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SETUP (Once per employee):                                     │
│  ┌────────────┐                                                 │
│  │  Employee  │──generates──►(spend_key, view_key)              │
│  └─────┬──────┘              │                                  │
│        │                     ▼                                  │
│        │          ┌─────────────────────┐                       │
│        └─register─►│ StealthMetaAddress │                       │
│                    │ (S, V) on-chain    │                       │
│                    └─────────────────────┘                       │
│                                                                 │
│  PAYMENT (Each payroll):                                        │
│  ┌────────────┐     fetch meta      ┌─────────────────┐        │
│  │  Employer  │─────────────────────►│ StealthMeta    │        │
│  └─────┬──────┘                      └────────┬────────┘        │
│        │                                      │                 │
│        │◄────────────(S, V)───────────────────┘                 │
│        │                                                        │
│        │  generate ephemeral (r), compute stealth address       │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────┐    ┌───────────────┐    ┌─────────────┐       │
│  │ ShadowVest  │───►│ Stealth Addr  │───►│ StealthPay  │       │
│  │ (ZK proof)  │    │ (unlinkable)  │    │ Event (R)   │       │
│  └─────────────┘    └───────────────┘    └──────┬──────┘       │
│                                                  │              │
│  CLAIM (Employee scans & withdraws):             │              │
│  ┌────────────┐                                  │              │
│  │  Employee  │◄────────scan events──────────────┘              │
│  └─────┬──────┘                                                 │
│        │                                                        │
│        │  derive stealth_privkey from (s, v, R)                 │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────┐                                                │
│  │ Spend from  │──►[Private Wallet]                             │
│  │ Stealth Addr│                                                │
│  └─────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.7 Arcium MPC Meta-Keys Storage (Optional Enhancement)

The reference implementation includes **secure MPC storage** for meta-keys using Arcium:

```
┌─────────────────────────────────────────────────────────────────┐
│              MPC META-KEYS STORAGE FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  WHY: Store (spend_key, view_key) securely on-chain             │
│  - Employee doesn't need to manage keys locally                 │
│  - Keys never exposed in plaintext on-chain                     │
│  - MPC re-encrypts keys specifically for each read request      │
│                                                                 │
│  WRITE (Store keys):                                            │
│  ┌────────────┐    Enc<Shared>     ┌─────────────────┐         │
│  │  Employee  │───────────────────►│ Arcium MPC      │         │
│  │  (client)  │   (encrypted)      │ write_meta_keys │         │
│  └────────────┘                    └────────┬────────┘         │
│                                             │                   │
│                                             ▼                   │
│                                    ┌─────────────────┐         │
│                                    │ MetaKeysVault   │         │
│                                    │ Enc<Mxe> stored │         │
│                                    └─────────────────┘         │
│                                                                 │
│  READ (Retrieve keys):                                          │
│  ┌────────────┐    session_key     ┌─────────────────┐         │
│  │  Employee  │───────────────────►│ Arcium MPC      │         │
│  │  (client)  │                    │ read_meta_keys  │         │
│  └────────────┘                    └────────┬────────┘         │
│        ▲                                    │                   │
│        │         Enc<Shared>                │                   │
│        └────────(re-encrypted)──────────────┘                   │
│                                                                 │
│  CIRCUIT CODE (encrypted-ixs):                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  pub struct MetaKeys {                                    │  │
│  │    pub meta_spend_priv_lo: u128,  // bytes 0-15           │  │
│  │    pub meta_spend_priv_hi: u128,  // bytes 16-31          │  │
│  │    pub meta_view_priv_lo: u128,   // bytes 0-15           │  │
│  │    pub meta_view_priv_hi: u128,   // bytes 16-31          │  │
│  │  }                                                        │  │
│  │                                                           │  │
│  │  fn write_meta_keys(input: Enc<Shared>, mxe: Mxe)         │  │
│  │    -> Enc<Mxe> { mxe.from_arcis(input.to_arcis()) }       │  │
│  │                                                           │  │
│  │  fn read_meta_keys(requester: Shared, stored: Enc<Mxe>)   │  │
│  │    -> Enc<Shared> { requester.from_arcis(stored.to_arcis()) }│
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Account Structure:**
```rust
#[account]
pub struct MetaKeysVault {
    pub ciphertexts: [[u8; 32]; 4],  // [spend_lo, spend_hi, view_lo, view_hi]
    pub nonce: u128,
}
```

### 5.8 Complete ShadowVest Integration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SHADOWVEST COMPLETE PRIVACY FLOW                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PHASE 1: EMPLOYEE ONBOARDING                                         │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  Employee generates stealth meta-keys:                                │   │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐   │   │
│  │  │ spend_key(s) │    │ view_key(v)  │    │ Share with employer: │   │   │
│  │  │ (secret)     │    │ (secret)     │    │ S = s*G, V = v*G     │   │   │
│  │  └──────────────┘    └──────────────┘    └──────────────────────┘   │   │
│  │         │                   │                       │                │   │
│  │         └───────────────────┴───────────────────────┘                │   │
│  │                             │                                         │   │
│  │                             ▼                                         │   │
│  │  Optional: Store in MPC    ┌─────────────────────┐                   │   │
│  │  (Arcium encrypted)   ────►│ MetaKeysVault       │                   │   │
│  │                            │ Enc<Mxe> on-chain   │                   │   │
│  │                            └─────────────────────┘                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PHASE 2: EMPLOYER CREATES VESTING (Privacy Preserved)                │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  1. Derive stealth address          2. Create compressed position    │   │
│  │  ┌──────────────────────────┐       ┌────────────────────────────┐  │   │
│  │  │ r = random ephemeral     │       │ Light Protocol CPI         │  │   │
│  │  │ R = r*G (publish)        │       │ - stealth_beneficiary      │  │   │
│  │  │ shared = r*V             │  ───► │ - encrypted_total_amount   │  │   │
│  │  │ stealth = S + H(shared)*G│       │ - emit: StealthPayEvent(R) │  │   │
│  │  └──────────────────────────┘       └────────────────────────────┘  │   │
│  │                                                │                     │   │
│  │  3. Encrypt vesting amount (Arcium MPC)        │                     │   │
│  │  ┌──────────────────────────┐                  │                     │   │
│  │  │ init_position circuit    │◄─────────────────┘                     │   │
│  │  │ - total_amount encrypted │                                        │   │
│  │  │ - stored in Merkle tree  │                                        │   │
│  │  └──────────────────────────┘                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PHASE 3: EMPLOYEE DISCOVERS & CLAIMS                                 │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  1. Scan events for payments        2. Derive spending key           │   │
│  │  ┌──────────────────────────┐       ┌────────────────────────────┐  │   │
│  │  │ For each R in events:    │       │ shared = v*R (same secret) │  │   │
│  │  │ - compute stealth addr   │  ───► │ stealth_priv = s+H(shared) │  │   │
│  │  │ - check if matches mine  │       │ Can now sign transactions! │  │   │
│  │  └──────────────────────────┘       └────────────────────────────┘  │   │
│  │                                                │                     │   │
│  │  3. Generate ZK proof (Noir)       4. Process claim                  │   │
│  │  ┌──────────────────────────┐       ┌────────────────────────────┐  │   │
│  │  │ Prove in browser:        │       │ ShadowVest verifies:       │  │   │
│  │  │ - I control stealth addr │  ───► │ - Noir proof valid         │  │   │
│  │  │ - claim ≤ vested amount  │       │ - Nullifier not used       │  │   │
│  │  │ - nullifier commitment   │       │ - Update position (Light)  │  │   │
│  │  └──────────────────────────┘       └────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PHASE 4: WITHDRAWAL OPTIONS                                          │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  Option A: Direct USDC          Option B: Cross-Chain (CCTP)         │   │
│  │  ┌────────────────────┐         ┌─────────────────────────────┐     │   │
│  │  │ Transfer to any    │         │ Bridge to: ETH, Base, Arb,  │     │   │
│  │  │ Solana wallet      │         │ Polygon, Avalanche, Noble   │     │   │
│  │  │ (stealth or real)  │         │ Native USDC, no wrapped     │     │   │
│  │  └────────────────────┘         └─────────────────────────────┘     │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PRIVACY GUARANTEES                                                   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  ✅ Amount Privacy     → Arcium MPC (encrypted vesting calculations)│   │
│  │  ✅ Sender Privacy     → Noir ZK (prove eligibility without reveal) │   │
│  │  ✅ Receiver Privacy   → Stealth Addresses (one-time ECDH addresses)│   │
│  │  ✅ Cost Efficiency    → Light Protocol (5000x cheaper positions)   │   │
│  │  ✅ Cross-Chain        → CCTP (native USDC to 9 chains)             │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Models & State

> **Documentation Links:**
> - [Anchor Account Constraints](https://www.anchor-lang.com/docs/account-constraints) - Account validation
> - [Anchor Account Types](https://docs.rs/anchor-lang/latest/anchor_lang/accounts/index.html) - Rust account types
> - [Solana Account Model](https://solana.com/docs/core/accounts) - How Solana accounts work
> - [PDAs (Program Derived Addresses)](https://solana.com/docs/core/pda) - Deterministic addresses
> - [SPL Token Accounts](https://spl.solana.com/token) - Token account structure

### 6.1 Account Types

```rust
/// Employer/Organization Account (regular Solana account)
#[account]
pub struct Organization {
    /// Organization admin
    pub admin: Pubkey,
    /// Organization name hash
    pub name_hash: [u8; 32],
    /// Total positions created
    pub position_count: u64,
    /// Merkle tree for compressed positions
    pub merkle_tree: Pubkey,
    /// Treasury vault
    pub treasury: Pubkey,
    /// Bump seed
    pub bump: u8,
}

/// Vesting Schedule Template (regular Solana account)
#[account]
pub struct VestingSchedule {
    /// Parent organization
    pub organization: Pubkey,
    /// Schedule identifier
    pub schedule_id: u64,
    /// Cliff duration (seconds)
    pub cliff_duration: u64,
    /// Total vesting duration (seconds)
    pub total_duration: u64,
    /// Vesting interval (seconds, 0 = continuous)
    pub vesting_interval: u64,
    /// Token mint
    pub token_mint: Pubkey,
    /// Is active
    pub active: bool,
    /// Bump seed
    pub bump: u8,
}

/// Compressed Position (stored in Merkle tree via Light Protocol)
/// See Section 2.2 for schema

/// Nullifier Registry (bitmap for used nullifiers)
#[account]
pub struct NullifierRegistry {
    /// Bitmap of used nullifiers
    pub bitmap: [u8; 8192], // 65536 bits
    /// Registry index
    pub index: u64,
}
```

### 6.2 State Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                    STATE MACHINE                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐     create      ┌──────────┐                     │
│  │ NONE     │────────────────►│ ACTIVE   │                     │
│  └──────────┘                 └────┬─────┘                     │
│                                    │                            │
│                    ┌───────────────┼───────────────┐           │
│                    │               │               │           │
│                    ▼               ▼               ▼           │
│              ┌──────────┐   ┌──────────┐   ┌──────────┐       │
│              │ VESTING  │   │ CLIFF    │   │CANCELLED │       │
│              │ (linear) │   │ (waiting)│   │          │       │
│              └────┬─────┘   └────┬─────┘   └──────────┘       │
│                   │              │                             │
│                   └──────┬───────┘                             │
│                          ▼                                     │
│                   ┌──────────┐                                 │
│                   │ CLAIMABLE│                                 │
│                   └────┬─────┘                                 │
│                        │                                       │
│          ┌─────────────┼─────────────┐                        │
│          ▼             ▼             ▼                        │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│   │ PARTIAL  │  │ CLAIMED  │  │ BRIDGED  │                   │
│   │ CLAIM    │  │ (direct) │  │ (CCTP)   │                   │
│   └──────────┘  └──────────┘  └──────────┘                   │
│                                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Implementation Phases

> **Documentation Links:**
> - [Anchor Getting Started](https://www.anchor-lang.com/docs/installation) - Anchor setup
> - [Solana CLI Tools](https://docs.solanalabs.com/cli/install) - Local development
> - [Arcium Installation](https://docs.arcium.com/developers/installation) - Arcium CLI (arcup)
> - [Noir Installation](https://noir-lang.org/docs/getting_started/quick_start) - Nargo CLI setup
> - [Light Protocol Setup](https://www.zkcompression.com/introduction/installation) - ZK Compression SDK
> - [Solana Test Validator](https://solana.com/docs/core/clusters#solana-test-validator) - Local testing

### Phase 1: Foundation (Week 1-2)

**Goal**: Core vesting contract with Arcium MPC

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| Define account schemas | HIGH | None | [Anchor Accounts](https://www.anchor-lang.com/docs/account-constraints) |
| Implement `create_organization` | HIGH | Schemas | [Anchor Instructions](https://www.anchor-lang.com/docs/the-program-module) |
| Implement `create_vesting_schedule` | HIGH | Organization | [PDAs](https://solana.com/docs/core/pda) |
| Implement basic vesting calculation (Arcium) | HIGH | Schedule | [Arcium Hello World](https://docs.arcium.com/developers/hello-world) |
| Write encrypted-ixs for vesting math | HIGH | Arcium setup | [Arcis Framework](https://docs.arcium.com/developers/arcis) |
| Unit tests | HIGH | All above | [Anchor Testing](https://www.anchor-lang.com/docs/testing) |

**Deliverables**:
- `programs/shadowvest/src/lib.rs` - Main program
- `encrypted-ixs/src/vesting.rs` - MPC computations
- Basic test suite

### Phase 2a: Light Protocol - Compressed Vesting Positions (Week 3)

**Goal**: Store vesting positions as compressed PDAs for 5000x cost reduction

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| Set up Light Protocol SDK (Rust) | HIGH | Phase 1 | [Installation](https://www.zkcompression.com/introduction/installation) |
| Implement compressed position creation | HIGH | Light SDK | [Create Compressed Accounts](https://www.zkcompression.com/compressed-pdas/guides/how-to-create-compressed-accounts) |
| Implement Merkle proof verification | HIGH | Compressed positions | [Merkle Trees](https://www.zkcompression.com/learn/core-concepts/merkle-trees-validity-proofs) |
| CPI to Light System Program | HIGH | All above | [Program Examples](https://www.zkcompression.com/compressed-pdas/program-examples) |
| Integration tests | HIGH | All above | [Client Guide](https://www.zkcompression.com/client-library/client-guide) |

**Deliverables**:
- `state/compressed_position.rs` - Compressed position schema (DONE)
- Light Protocol CPI integration
- Compressed vesting position CRUD operations
- Cost benchmarks vs regular accounts

**Current Status**: Schema implemented, CPI integration pending due to light-sdk v0.18.0 API alignment

### Phase 2b: Light Protocol - Compressed Token Distribution (Week 3-4)

**Goal**: Distribute payroll using compressed tokens for 400x cost reduction

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| Set up Light Protocol SDK (TypeScript) | HIGH | Phase 1 | [@lightprotocol/stateless.js](https://www.npmjs.com/package/@lightprotocol/stateless.js) |
| Implement batch payroll distribution | HIGH | Light SDK | [Airdrop Guide](https://www.zkcompression.com/compressed-tokens/advanced-guides/airdrop) |
| Implement token decompression | HIGH | Distribution | [Compressed Tokens](https://www.zkcompression.com/compressed-tokens/overview) |
| Retry logic & error handling | MEDIUM | Distribution | [Example Token Distribution](https://github.com/Lightprotocol/example-token-distribution) |
| Integration with vesting claims | HIGH | Phase 2a | - |

**Deliverables**:
- `lib/compressed-payroll.ts` - Batch distribution client
- `lib/token-decompress.ts` - Decompression helper
- Integration tests for 100+ recipient batches
- Cost comparison documentation

**Key Implementation Notes**:
- Use `@lightprotocol/compressed-token` for client-side distribution
- Batch 5 recipients per instruction (configurable)
- ~120,000 compute units per recipient
- Recipients can decompress to regular SPL tokens anytime

**Current Status**: ✅ COMPLETE
- `lib/compressed-payroll.ts` - Created with distributePayroll(), decompressTokens(), getCompressedBalance()
- `tests/compressed-payroll.ts` - Unit tests passing (6/6)
- Integration tests ready (require Helius RPC + token pool setup)

### Phase 2c: USDC + CCTP Cross-Chain Integration (Week 4)

**Goal**: Enable cross-chain USDC payments via Circle's CCTP

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| Research CCTP integration | HIGH | Phase 2b | [CCTP Docs](https://developers.circle.com/cctp) |
| Create USDC token pool on Light Protocol | HIGH | Phase 2b | [Token Pools](https://www.zkcompression.com/compressed-tokens/overview) |
| Implement CCTP bridge functions | HIGH | Token pool | [Solana CCTP](https://github.com/circlefin/solana-cctp-contracts) |
| Add cross-chain withdrawal UI | MEDIUM | CCTP functions | [Circle API](https://developers.circle.com/stablecoins/cctp-getting-started) |
| Test cross-chain flows (Solana ↔ Base) | HIGH | All above | - |

**Deliverables**:
- `lib/cctp-bridge.ts` - Cross-chain USDC bridge functions
- `lib/usdc-constants.ts` - USDC addresses and CCTP program IDs
- Integration tests for cross-chain transfers
- Documentation for employee withdrawal options

**Key Implementation Notes**:
- Use devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Use mainnet USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- CCTP V2 programs are recommended for new integrations
- Attestation fetching from Circle API typically takes 10-20 minutes

### Phase 3: Noir ZK Circuits (Week 5)

**Goal**: Zero-knowledge proof verification

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| Set up Noir development environment | HIGH | None | [Quick Start](https://noir-lang.org/docs/getting_started/quick_start) |
| Implement withdrawal proof circuit | HIGH | Noir setup | [Language Reference](https://noir-lang.org/docs/noir/concepts/data_types) |
| Implement identity proof circuit | MEDIUM | Noir setup | [Standard Library](https://noir-lang.org/docs/noir/standard_library) |
| On-chain verifier integration | HIGH | Circuits | [Solidity Verifier](https://noir-lang.org/docs/how_to/how-to-solidity-verifier) |
| Proof generation client library | HIGH | Circuits | [NoirJS App](https://noir-lang.org/docs/tutorials/noirjs_app) |

**Deliverables**:
- `circuits/withdrawal_proof/` - Noir circuit
- On-chain verifier
- TypeScript proof generation library

### Phase 4: Stealth Addresses (Week 5)

**Goal**: Complete receiver privacy with ECDH stealth addresses

**Reference Implementation**: `stealth/` folder contains working code to adapt

| Task | Priority | Dependencies | Source Reference |
|------|----------|--------------|------------------|
| Add stealth instructions to program | HIGH | Phase 1 | `stealth/program/lib.rs` |
| Update Arcium circuits (v0.3→v0.6) | MEDIUM | Arcium | `stealth/encrypted-ixs/lib.rs` |
| Integrate with CompressedVestingPosition | HIGH | Phase 2a | Add `stealth_address` field |
| Payment scanning service | HIGH | Events | Websocket listener |
| Implement `process_claim` instruction | HIGH | Phase 3 | Connect Noir + Stealth |

**Specific Tasks:**

**Task 4.1: Port Stealth Library**
```
Target: contract/lib/stealth-address.ts

Functions to port:
- deriveStealthPub(metaSpend, metaView, ephPriv) → stealthPubkey
- deriveStealthKeypair(metaSpendPriv, metaViewPub, ephPriv) → StealthSigner
- encryptEphemeralPrivKey(ephPriv, metaViewPub) → encryptedPayload
- decryptEphemeralPrivKey(payload, metaViewPriv, ephPub) → ephPriv
- encryptNote() / decryptNote() → private messages
- StealthSigner class → sign transactions from derived scalar
```

**Task 4.2: Add Stealth Program Instructions**
```
Source: stealth/program/lib.rs
Target: contract/programs/contract/src/instructions/stealth.rs

Instructions to add:
- register_stealth_meta() - Employee registers (S, V) pubkeys
- pay_to_stealth() - Create vesting with stealth beneficiary
- withdraw_from_stealth() - Spend with derived key

Events to add:
- StealthPaymentEvent { ephemeral_pubkey, stealth_address, encrypted_memo }
```

**Task 4.3: Update Arcium Circuits (Optional MPC Storage)**
```
Source: stealth/encrypted-ixs/lib.rs (Arcium v0.3.0)
Target: contract/encrypted-ixs/src/lib.rs (Arcium v0.6.3)

Circuits to add:
- write_meta_keys: Enc<Shared> → Enc<Mxe>
- read_meta_keys: Enc<Mxe> → Enc<Shared>

Account to add:
- MetaKeysVault { ciphertexts: [[u8;32];4], nonce: u128 }
```

**Task 4.4: Integrate with Vesting Positions**
```
Modify: contract/programs/contract/src/state/compressed_position.rs

Add field:
- stealth_beneficiary: Pubkey (stealth address, not real identity)

Modify create_compressed_vesting_position:
- Accept stealth_address instead of beneficiary_commitment
- Emit ephemeral_pubkey in event for scanning
```

**Deliverables**:
- `contract/lib/stealth-address.ts` - Ported ECDH implementation
- `contract/programs/contract/src/instructions/stealth.rs` - Stealth instructions
- `contract/programs/contract/src/state/stealth_meta.rs` - Meta address account
- Updated `CompressedVestingPosition` with stealth support
- Employee scanning service (TypeScript)

### Phase 5: Frontend & Testing (Week 6)

**Goal**: Usable MVP

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| React frontend scaffold | HIGH | None | [Vite](https://vitejs.dev/guide/) |
| Wallet integration | HIGH | Scaffold | [Solana Wallet Adapter](https://github.com/solana-labs/wallet-adapter) |
| Organization dashboard | HIGH | Backend APIs | [React Query](https://tanstack.com/query/latest) |
| Employee withdrawal interface | HIGH | ZK proofs | [NoirJS](https://noir-lang.org/docs/tutorials/noirjs_app) |
| End-to-end testing | HIGH | All components | [Playwright](https://playwright.dev/docs/intro) |
| Security audit prep | MEDIUM | All above | [Solana Security](https://solana.com/docs/programs#security) |

**Deliverables**:
- `/app` - React frontend
- Full integration tests
- Security documentation

---

## 8. Directory Structure

> **Documentation Links:**
> - [Anchor Project Structure](https://www.anchor-lang.com/docs/project-template) - Standard Anchor layout
> - [Cargo Workspaces](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html) - Rust project organization
> - [Nargo Project Structure](https://noir-lang.org/docs/getting_started/project_breakdown) - Noir circuit layout

```
kage/
├── contract/
│   ├── programs/
│   │   └── shadowvest/
│   │       └── src/
│   │           ├── lib.rs                # Main program entry
│   │           ├── instructions/
│   │           │   ├── mod.rs
│   │           │   ├── organization.rs   # Org management
│   │           │   ├── vesting.rs        # Vesting operations
│   │           │   ├── claim.rs          # Claim operations
│   │           │   ├── withdraw.rs       # Withdrawal with ZK
│   │           │   └── stealth.rs        # Stealth address payments
│   │           ├── state/
│   │           │   ├── mod.rs
│   │           │   ├── organization.rs
│   │           │   ├── schedule.rs
│   │           │   ├── position.rs
│   │           │   └── stealth_meta.rs   # Stealth meta-address
│   │           ├── light_integration.rs  # Light Protocol PDAs (5000x savings)
│   │           ├── stealth_registry.rs   # ECDH Stealth addresses
│   │           └── errors.rs
│   │
│   ├── lib/                              # Client-side TypeScript libraries
│   │   ├── compressed-payroll.ts         # Batch token distribution (400x savings)
│   │   ├── token-decompress.ts           # Decompress to regular SPL
│   │   └── stealth-address.ts            # ECDH stealth implementation
│   │
│   ├── encrypted-ixs/
│   │   └── src/
│   │       ├── lib.rs
│   │       └── vesting.rs                # MPC computations
│   │
│   ├── circuits/
│   │   ├── withdrawal_proof/
│   │   │   ├── Nargo.toml
│   │   │   └── src/
│   │   │       └── main.nr               # Withdrawal ZK circuit
│   │   ├── identity_proof/
│   │   │   ├── Nargo.toml
│   │   │   └── src/
│   │   │       └── main.nr               # Identity ZK circuit
│   │   └── stealth_claim/
│   │       ├── Nargo.toml
│   │       └── src/
│   │           └── main.nr               # Stealth claim proof
│   │
│   ├── tests/
│   │   ├── shadowvest.ts                 # Integration tests
│   │   ├── stealth.ts                    # Stealth address tests
│   │   └── utils/
│   │       ├── merkle.ts
│   │       ├── encryption.ts
│   │       └── stealth-address.ts        # ECDH helpers
│   │
│   ├── app/                              # Frontend (Phase 5)
│   │   ├── package.json
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── components/
│   │       │   ├── StealthSetup.tsx      # Employee stealth setup
│   │       │   ├── PayrollDashboard.tsx  # Employer dashboard
│   │       │   └── ClaimInterface.tsx    # Employee claim UI
│   │       ├── hooks/
│   │       │   ├── useStealthAddress.ts  # Stealth addr hook
│   │       │   └── useZkProof.ts         # Proof generation
│   │       └── lib/
│   │           ├── proof-generator.ts    # Noir proof gen
│   │           ├── encryption.ts         # X25519 encryption
│   │           └── stealth-address.ts    # ECDH stealth impl
│   │
│   ├── Anchor.toml
│   ├── Arcium.toml
│   └── Cargo.toml
│
└── ARCHITECTURE.md                       # This file
```

---

## 9. Security Considerations

> **Documentation Links:**
> - [Solana Security Best Practices](https://solana.com/docs/programs#security) - Program security
> - [Anchor Security](https://www.anchor-lang.com/docs/common-security-exploits) - Common exploits
> - [Sealevel Attacks](https://github.com/coral-xyz/sealevel-attacks) - Solana vulnerability examples
> - [ZK Circuit Security](https://www.rareskills.io/post/zk-security) - ZK proof pitfalls
> - [OWASP Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/) - Crypto security
> - [MPC Security Considerations](https://docs.arcium.com/learn/security) - Arcium security model
> - [Groth16 Security](https://eprint.iacr.org/2016/260.pdf) - ZK-SNARK security paper

### 9.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| **Salary disclosure** | Arcium MPC encryption + Light compression |
| **Withdrawal tracing** | Stealth addresses + ZK nullifiers |
| **Double withdrawal** | Nullifier registry + Merkle proofs |
| **Identity linkage** | Pedersen commitments + ZK identity proofs |
| **Receiver address reuse** | ECDH Stealth addresses (Layer 4) |
| **Oracle manipulation** | On-chain timestamps only |
| **Key compromise** | Separate spend/view keys for stealth |
| **Metadata leakage** | Encrypted memos + timing obfuscation |

### 9.2 Privacy Layer Comparison

| Layer | Hides Amount | Hides Sender | Hides Receiver | Hides Timing |
|-------|--------------|--------------|----------------|--------------|
| Light Protocol | ❌ | ❌ | ❌ | ❌ |
| Arcium MPC | ✅ | ❌ | ❌ | ❌ |
| Noir ZK | ✅ | ✅ | ❌ | ❌ |
| Stealth Addresses | ❌ | ❌ | ✅ | ❌ |
| **Combined** | ✅ | ✅ | ✅ | ❌ |

### 9.3 Audit Checklist

- [ ] Arcium encryption key management
- [ ] Merkle tree integrity
- [ ] Nullifier uniqueness
- [ ] ZK circuit soundness
- [ ] Stealth address ECDH correctness
- [ ] View key scanning privacy
- [ ] Access control validation
- [ ] CCTP bridge security

---

## 10. Production Roadmap: Streaming Payroll (Multiple Claims)

### 10.1 Current MVP vs Production

The current MVP implementation supports **one-time claiming** per position. For production streaming payroll, users need to claim **multiple times** as tokens vest over time.

| Feature | MVP (Current) | Production (Streaming) |
|---------|---------------|------------------------|
| Claims per position | 1 (claim all at once) | Multiple (partial claims) |
| User behavior | Wait until 100% vested | Claim as tokens vest |
| Nullifier | Fixed per position | Unique per claim |
| UI state | "Claimed" vs "Not Claimed" | "X of Y tokens claimed" |

### 10.2 Vesting Flow Example

```
Total Vesting: 100 tokens over 12 months

Month 1:  8 tokens vested  → User claims 8   → 92 remaining
Month 3:  25 tokens vested → User claims 17  → 75 remaining
Month 6:  50 tokens vested → User claims 25  → 50 remaining
Month 12: 100 tokens vested → User claims 50 → 0 remaining ✅ Fully Claimed
```

### 10.3 Smart Contract Changes

#### A. Nullifier Generation

**Current (MVP):**
```rust
// Fixed per position - only allows ONE claim
nullifier = hash(stealth_pubkey, position_id)
```

**Production:**
```rust
// Unique per claim attempt - allows multiple claims
nullifier = hash(stealth_pubkey, position_id, claim_nonce)
// OR
nullifier = hash(stealth_pubkey, position_id, claimed_amount_before, claim_amount)
```

#### B. ClaimAuthorization Account

**Current:**
```rust
pub struct ClaimAuthorization {
    pub organization: Pubkey,
    pub position_id: u64,
    pub nullifier: [u8; 32],
    pub destination: Pubkey,
    pub claim_amount: u64,
    pub is_processed: bool,
}
```

**Production:**
```rust
pub struct ClaimAuthorization {
    pub organization: Pubkey,
    pub position_id: u64,
    pub nullifier: [u8; 32],
    pub destination: Pubkey,
    pub claim_amount: u64,
    pub cumulative_claimed: u64,  // NEW: Total claimed so far
    pub claim_index: u32,         // NEW: Which claim (1st, 2nd, 3rd...)
    pub is_processed: bool,
    pub timestamp: i64,           // NEW: When claimed
}
```

#### C. Validation Logic

**Production:**
```rust
// Check nullifier not used (but allow new nullifiers for same position)
require!(nullifier_record.is_none(), "This specific claim already processed");

// Check claim amount doesn't exceed available
let available = vested_amount - already_claimed;
require!(claim_amount <= available, "Exceeds available amount");
```

#### D. New Instruction: `get_claimable_amount`

```rust
// MPC computation to return how much user can currently claim
pub fn get_claimable_amount(
    position_id: u64,
    encrypted_total: [u8; 32],
    encrypted_claimed: [u8; 32],
    current_timestamp: i64,
) -> Result<u64> {
    // MPC decrypts and calculates:
    // vested = total * vesting_progress
    // claimable = vested - already_claimed
    return claimable;
}
```

### 10.4 Backend Changes

#### A. Database Schema

**New Table: `claim_history`**
```sql
CREATE TABLE claim_history (
    id UUID PRIMARY KEY,
    position_id VARCHAR NOT NULL,
    organization_pubkey VARCHAR NOT NULL,
    wallet_address VARCHAR NOT NULL,

    claim_index INTEGER NOT NULL,        -- 1, 2, 3...
    claim_amount BIGINT NOT NULL,        -- This claim
    cumulative_claimed BIGINT NOT NULL,  -- Total after this claim

    nullifier VARCHAR NOT NULL UNIQUE,
    claim_auth_pda VARCHAR NOT NULL,

    tx_signature VARCHAR,
    status VARCHAR NOT NULL,             -- 'pending', 'processing', 'completed', 'failed'

    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

**Update: `vesting_positions` table**
```sql
ALTER TABLE vesting_positions ADD COLUMN
    total_claimed BIGINT DEFAULT 0,
    last_claim_at TIMESTAMP,
    claim_count INTEGER DEFAULT 0,
    is_fully_claimed BOOLEAN DEFAULT FALSE;
```

#### B. New API Endpoints

```typescript
// Get claimable amount for a position
GET /api/positions/:id/claimable
Response: {
    totalAmount: "100000000",
    vestedAmount: "50000000",
    claimedAmount: "25000000",
    claimableNow: "25000000",
    vestingProgress: 50,
    nextVestingAt: "2026-03-01T00:00:00Z"
}

// Get claim history for a position
GET /api/positions/:id/claims
Response: {
    claims: [
        { index: 1, amount: "10000000", timestamp: "...", txSignature: "..." },
        { index: 2, amount: "15000000", timestamp: "...", txSignature: "..." },
    ],
    totalClaimed: "25000000"
}

// Submit partial claim
POST /api/positions/:id/claim
Body: {
    claimAmount: "10000000",  // Specific amount, not "max"
    claimNonce: 2             // For nullifier uniqueness
}
```

### 10.5 Frontend Changes

#### A. Position Card UI

**Current:**
```
Position #11
Status: Fully Vested
Progress: 100%
[Claim Tokens]
```

**Production:**
```
Position #11
Total: 100 tokens
├── Vested: 75 tokens (75%)
├── Claimed: 25 tokens
└── Available: 50 tokens

Progress: [████████░░] 75% vested
Claimed:  [██░░░░░░░░] 25% claimed

[Claim 50 Tokens]  or  [Claim Custom Amount]
```

#### B. Claim Modal (Production)

```
┌─────────────────────────────────────┐
│  Claim from Position #11            │
│                                     │
│  Available to claim: 50 tokens      │
│                                     │
│  Amount: [___________] tokens       │
│          ○ Claim all (50)           │
│          ○ Custom amount            │
│                                     │
│  Claim History:                     │
│  • Feb 1: Claimed 15 tokens         │
│  • Jan 15: Claimed 10 tokens        │
│                                     │
│  [Cancel]  [Claim]                  │
└─────────────────────────────────────┘
```

#### C. Position Status Logic

```typescript
function getPositionStatus(position) {
    if (position.isFullyClaimed) return 'completed';
    if (position.claimableNow > 0) return 'claimable';
    if (position.isInCliff) return 'cliff';
    if (position.vestedAmount > position.claimedAmount) return 'vesting';
    return 'waiting'; // Vested = Claimed, waiting for more to vest
}
```

### 10.6 Nullifier Strategy Options

#### Option A: Claim Counter (Recommended)

```typescript
nullifier = hash(stealthPubkey, positionId, claimIndex)
// Claim 1: hash(key, 11, 0)
// Claim 2: hash(key, 11, 1)
// Claim 3: hash(key, 11, 2)
```

| Pros | Cons |
|------|------|
| Simple, predictable | Need to track claim count |
| Easy to verify | Sequential claims required |
| Clear audit trail | |

#### Option B: Timestamp-based

```typescript
nullifier = hash(stealthPubkey, positionId, timestamp)
```

| Pros | Cons |
|------|------|
| No counter needed | Timestamp manipulation risk |
| Flexible timing | Harder to audit |

#### Option C: Amount-based

```typescript
nullifier = hash(stealthPubkey, positionId, previousClaimed, claimAmount)
```

| Pros | Cons |
|------|------|
| Self-documenting | Complex verification |
| Prevents double-claim | Edge cases with same amounts |

**Recommendation: Option A (Claim Counter)** - Simple, predictable, and easy to audit.

### 10.7 MPC Computation Changes

#### Current MPC: `process_claim_v2`

```
Input: encrypted_total, encrypted_claimed, claim_amount
Output: approved_amount (capped at vested - claimed)
```

#### Production MPC: `process_partial_claim`

```
Input:
  - encrypted_total_amount
  - encrypted_claimed_so_far
  - requested_claim_amount
  - vesting_schedule_params
  - current_timestamp

Output:
  - approved_claim_amount
  - new_encrypted_claimed_amount (claimed_so_far + approved)
  - is_fully_claimed (boolean)

Computation:
  1. Decrypt total and claimed
  2. Calculate vested based on schedule
  3. available = vested - claimed
  4. approved = min(requested, available)
  5. new_claimed = claimed + approved
  6. Encrypt new_claimed
  7. Return results
```

### 10.8 Security Considerations

| Risk | Mitigation |
|------|------------|
| Double-claim same nullifier | Contract checks nullifier uniqueness |
| Claim more than vested | MPC validates against schedule |
| Front-running claims | Nullifier tied to stealth key (only owner can create) |
| Replay attacks | Unique nullifier per claim |
| Claim counter manipulation | Counter stored on-chain, verified in contract |

### 10.9 Migration Path

#### Phase 1: Database & Backend
1. Add `claim_history` table
2. Add new API endpoints
3. Update claim processor to track history

#### Phase 2: Contract Update
1. Deploy new contract with updated nullifier logic
2. Add claim counter to ClaimAuthorization
3. Update MPC computation

#### Phase 3: Frontend
1. Update Position cards with claim history
2. Add partial claim UI
3. Show claimable amounts

#### Phase 4: Migration
1. Existing fully-claimed positions: Mark as completed
2. Existing partial positions: Calculate claimed from on-chain data
3. New positions: Use new flow

### 10.10 Implementation Summary

| Component | Changes Required | Effort |
|-----------|-----------------|--------|
| **Smart Contract** | Nullifier logic, ClaimAuth struct, validation | High |
| **MPC Circuit** | Return new_claimed_amount, handle partials | Medium |
| **Backend DB** | claim_history table, position tracking | Low |
| **Backend API** | New endpoints, claim processor updates | Medium |
| **Frontend UI** | Claim history, partial claim modal, status | Medium |

---

## 11. Sources & References

### USDC & Circle CCTP (Cross-Chain)
- [Circle CCTP Documentation](https://developers.circle.com/cctp) - Main CCTP docs
- [CCTP Getting Started Guide](https://developers.circle.com/stablecoins/cctp-getting-started) - Integration quickstart
- [Solana CCTP Contracts](https://github.com/circlefin/solana-cctp-contracts) - Official Solana contracts
- [Circle Developer Console](https://console.circle.com/) - API access and keys
- [USDC on Solana (Solscan)](https://solscan.io/token/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) - Token explorer
- [Circle Blog: CCTP on Solana](https://www.circle.com/blog/new-pre-mint-address-for-usdc-on-solana) - Launch announcement
- **Key Addresses**:
  - Solana USDC Mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
  - Solana USDC Devnet: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
  - CCTP MessageTransmitter V2: `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC`
  - CCTP TokenMessengerMinter V2: `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe`

### Light Protocol (ZK Compression)
- [Light Protocol Documentation](https://www.zkcompression.com)
- [Light Protocol GitHub](https://github.com/Lightprotocol/light-protocol)
- [Compressed Accounts Guide](https://www.zkcompression.com/compressed-pdas/guides/how-to-create-compressed-accounts)
- [Merkle Trees & Validity Proofs](https://www.zkcompression.com/learn/core-concepts/merkle-trees-validity-proofs)
- [Compressed Tokens Overview](https://www.zkcompression.com/compressed-tokens/overview) - 400x cheaper token accounts
- [Airdrop/Distribution Guide](https://www.zkcompression.com/compressed-tokens/advanced-guides/airdrop) - Batch distribution
- [Example Token Distribution](https://github.com/Lightprotocol/example-token-distribution) - Reference implementation
- [@lightprotocol/stateless.js](https://www.npmjs.com/package/@lightprotocol/stateless.js) - Client SDK
- [@lightprotocol/compressed-token](https://www.npmjs.com/package/@lightprotocol/compressed-token) - Token SDK

### Arcium MPC
- [Arcium Documentation](https://docs.arcium.com)
- [Arcium Getting Started](https://docs.arcium.com/developers)
- [Arcium Examples Repository](https://github.com/arcium-hq/examples)
- [Arcis Framework Guide](https://docs.arcium.com/developers/arcis)
- **Key Concepts**:
  - Encrypted data processing via Multi-Party Computation (MPC)
  - Arcis Rust framework for confidential instructions
  - `#[encrypted]` module and `#[instruction]` function annotations
  - `Enc<Shared, T>` and `Enc<Mxe, T>` encrypted types
  - X25519 client-side encryption

### Noir Zero-Knowledge Circuits
- [Noir Language Documentation](https://noir-lang.org/docs/)
- [Noir Quick Start](https://noir-lang.org/docs/getting_started/quick_start)
- [NoirJS Web App Tutorial](https://noir-lang.org/docs/tutorials/noirjs_app)
- [Noir GitHub](https://github.com/noir-lang/noir)
- **Key Concepts**:
  - Domain-specific language for ZK proofs
  - Compiles to ACIR (Abstract Circuit Intermediate Representation)
  - Default backend: Aztec's Barretenberg (Groth16)
  - `nargo` CLI for compilation and proof generation
  - NoirJS for browser-based proof generation

### Stealth Addresses
- [GhostSol/Zera Privacy SDK](https://github.com/jskoiz/zeraprivacy) - Reference implementation
- [Solana Token-2022 Confidential Transfers](https://spl.solana.com/confidential-token/deep-dive/zkps)
- [ZK Extensions on Solana (arxiv)](https://arxiv.org/html/2511.00415)
- **Key Concepts**:
  - ECDH (Elliptic Curve Diffie-Hellman) key agreement
  - Ed25519 curve for Solana compatibility
  - Spend key (s) + View key (v) separation
  - Ephemeral keys (R) for each payment
  - Recipient scanning for incoming payments

### Solana Development
- [Anchor Framework](https://www.anchor-lang.com)
- [Solana Program Library](https://spl.solana.com/)
- [@noble/curves](https://github.com/paulmillr/noble-curves) - Cryptographic primitives
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) - Hash functions

---

*Generated for ShadowVest MVP - Privacy-First Payroll Protocol*
