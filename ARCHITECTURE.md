# ShadowVest Architecture Plan

## Privacy-First Payroll & Vesting Protocol on Solana

---

## Quick Reference Links

| Technology | Main Docs | GitHub | API/SDK |
|------------|-----------|--------|---------|
| **Light Protocol** | [zkcompression.com](https://www.zkcompression.com) | [GitHub](https://github.com/Lightprotocol/light-protocol) | [Client Guide](https://www.zkcompression.com/client-library/client-guide) |
| **Arcium MPC** | [docs.arcium.com](https://docs.arcium.com) | [Examples](https://github.com/arcium-hq/examples) | [Arcis Framework](https://docs.arcium.com/developers/arcis) |
| **Noir ZK** | [noir-lang.org/docs](https://noir-lang.org/docs/) | [GitHub](https://github.com/noir-lang/noir) | [NoirJS](https://noir-lang.org/docs/tutorials/noirjs_app) |
| **Radr ShadowPay** | [radrlabs.io/docs](https://www.radrlabs.io/docs) | [SDK](https://github.com/Radrdotfun/shadowpay-sdk) | [API](https://registry.scalar.com/@radr/apis/shadowpay-api) |
| **Stealth Addresses** | [EIP-5564](https://eips.ethereum.org/EIPS/eip-5564) | [Zera SDK](https://github.com/jskoiz/zeraprivacy) | [@noble/curves](https://github.com/paulmillr/noble-curves) |
| **Anchor** | [anchor-lang.com](https://www.anchor-lang.com) | [GitHub](https://github.com/coral-xyz/anchor) | [Rust Docs](https://docs.rs/anchor-lang/latest/anchor_lang/) |
| **Solana** | [solana.com/docs](https://solana.com/docs) | [GitHub](https://github.com/solana-labs/solana) | [Web3.js](https://solana-labs.github.io/solana-web3.js/) |

---

## Executive Summary

ShadowVest is a privacy-preserving payroll and vesting protocol that combines four complementary privacy technologies:

| Layer | Technology | Purpose | Docs |
|-------|------------|---------|------|
| **L1** | Light Protocol | Compressed state storage (5000x cost reduction) | [Docs](https://www.zkcompression.com) |
| **L2** | Arcium MPC | Confidential computation (encrypted calculations) | [Docs](https://docs.arcium.com) |
| **L3** | Noir ZK Circuits | Zero-knowledge proof verification | [Docs](https://noir-lang.org/docs/) |
| **L4** | Radr Labs ShadowPay | Shielded settlement (amount privacy + relayers) | [Docs](https://www.radrlabs.io/docs) |
| **L5** | ECDH Stealth Addresses | One-time receiver addresses (receiver privacy) | [EIP-5564](https://eips.ethereum.org/EIPS/eip-5564) |

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
│  ┌─────────┐  ┌─────────┐  ┌─────┐  ┌──────┐  ┌───────┐ │
│  │ Light   │  │ Arcium  │  │Noir │  │ Radr │  │Stealth│ │
│  │Protocol │◄─┤  MPC    │◄─┤ ZK  │◄─┤ Labs │◄─┤Address│ │
│  │(storage)│  │(compute)│  │(proof)│ │(settle)│ │(recv) │ │
│  └─────────┘  └─────────┘  └─────┘  └──────┘  └───────┘ │
└───────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1: Light Protocol - Compressed State Storage

> **Documentation Links:**
> - [Light Protocol Docs](https://www.zkcompression.com) - Main documentation
> - [Compressed Account Model](https://www.zkcompression.com/learn/core-concepts/compressed-account-model) - How compression works
> - [Create Compressed Accounts](https://www.zkcompression.com/compressed-pdas/guides/how-to-create-compressed-accounts) - Implementation guide
> - [Merkle Trees & Validity Proofs](https://www.zkcompression.com/learn/core-concepts/merkle-trees-validity-proofs) - Core concepts
> - [Light SDK Client Guide](https://www.zkcompression.com/client-library/client-guide) - Client integration
> - [GitHub: light-protocol](https://github.com/Lightprotocol/light-protocol) - Source code

### 2.1 Purpose

Store vesting positions as compressed accounts to achieve:
- **5000x cost reduction** vs regular Solana accounts
- **Merkle tree commitments** instead of full on-chain data
- **Scalability** to millions of vesting positions

### 2.2 Compressed Account Schema

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

### 2.3 Light Protocol Integration

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

### 2.4 State Tree Structure

```
Merkle Tree (State Root)
        │
   ┌────┴────┐
   │         │
 ┌─┴─┐     ┌─┴─┐
 │   │     │   │
Pos1 Pos2  Pos3 Pos4  (Compressed Vesting Positions)
```

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

## 5. Layer 4: Radr Labs ShadowPay - Shielded Settlement

> **Documentation Links:**
> - [Radr Labs Website](https://www.radrlabs.io/) - Main website
> - [ShadowPay API Reference](https://registry.scalar.com/@radr/apis/shadowpay-api) - Full API documentation
> - [ShadowID Documentation](https://www.radrlabs.io/docs/shadowid) - ZK identity layer
> - [@shadowpay/server NPM](https://www.npmjs.com/package/@shadowpay/server) - Server SDK
> - [ShadowPay App](https://www.radr.fun/) - Live application
> - [GitHub: Radrdotfun/shadowpay-sdk](https://github.com/Radrdotfun/shadowpay-sdk) - SDK source

### 5.1 Purpose

Enable private token withdrawals using Radr's ShadowPay infrastructure:
- **Amount privacy** - Payment amounts encrypted with ElGamal on BN254 curve
- **ZK verification** - Groth16 proofs verify transactions without revealing details
- **Relayer infrastructure** - Built-in relayers for transaction submission
- **MEV protection** - Private mempools prevent front-running

### 5.2 ShadowPay Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Encryption | ElGamal (BN254) | Encrypts payment amounts |
| Proofs | Groth16 ZK-SNARKs | Verifies transaction validity |
| Nullifiers | Bitmap-based | Prevents double-spending |
| Relayers | ShadowPay Network | Submits transactions privately |

### 5.3 What ShadowPay Provides vs Doesn't Provide

| Feature | Provided | Notes |
|---------|----------|-------|
| Amount Privacy | ✅ Yes | ElGamal encryption hides amounts |
| Sender Anonymity | ✅ Yes | Via relayer infrastructure |
| Stealth Addresses | ❌ No | Does not generate one-time addresses |
| Receiver Privacy | ⚠️ Partial | Requires stealth addresses (Layer 5) |

### 5.4 ShadowPay API Reference

**Base URL**: `https://api.shadowpay.io` (from registry.scalar.com/@radr/apis/shadowpay-api)

```typescript
// Server-side SDK installation
npm install @shadowpay/server

// Basic integration
import { ShadowPay } from '@shadowpay/server';

const shadowpay = new ShadowPay({
  apiKey: 'YOUR_API_KEY',
  apiUrl: 'https://api.shadowpay.io' // optional
});

// Express middleware for payment verification
app.get('/api/premium',
  shadowpay.requirePayment({ amount: 0.001, token: 'SOL' }),
  (req, res) => {
    res.json({ secret: 'Premium content!' });
  }
);

// Manual payment verification
const result = await shadowpay.verifyPayment({
  accessToken: 'token_from_client',
  amount: 0.001,
  token: 'SOL'
});

if (result.valid) {
  // Grant access
}

// Webhook handler for payment events
app.post('/webhooks/shadowpay',
  shadowpay.webhookHandler({
    'payment.success': async (event) => {
      console.log('Payment successful:', event.data);
    },
    'payment.failed': async (event) => {
      console.log('Payment failed:', event.data);
    },
    'payment.refunded': async (event) => {
      console.log('Payment refunded:', event.data);
    }
  })
);
```

### 5.5 Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    WITHDRAWAL FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Prove withdrawal eligibility (Noir ZK proof)                │
│     ┌────────────┐                                              │
│     │  Employee  │──generates──►[ZK Proof]                      │
│     └────────────┘                                              │
│                                                                 │
│  2. Submit to ShadowVest with proof                             │
│     [Proof]──►┌────────────────┐                                │
│               │ ShadowVest     │──verifies──►[Valid]            │
│               │ Program        │                                │
│               └───────┬────────┘                                │
│                       │                                         │
│  3. Release tokens to Radr Shielded Pool                        │
│                       ▼                                         │
│               ┌────────────────┐                                │
│               │ Radr Shielded  │◄──ElGamal encrypt amount       │
│               │ Pool           │                                │
│               └───────┬────────┘                                │
│                       │                                         │
│  4. Employee withdraws via ShadowPay                            │
│                       ▼                                         │
│               ┌────────────────┐                                │
│               │ ShadowPay      │──Groth16 proof──►[Relayer]     │
│               │ Verification   │                                │
│               └───────┬────────┘                                │
│                       │                                         │
│  5. Private settlement to stealth address (Layer 5)             │
│                       ▼                                         │
│               ┌────────────────┐                                │
│               │ Stealth Addr   │──private transfer──►[Wallet]   │
│               │ (ECDH derived) │                                │
│               └────────────────┘                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.6 Radr Integration Code

```rust
// programs/shadowvest/src/radr_integration.rs

use anchor_lang::prelude::*;
use radr_sdk::{ShieldedPool, DepositNote, WithdrawParams};

/// Deposit vested tokens into Radr shielded pool
pub fn shield_withdrawal(
    ctx: Context<ShieldWithdrawal>,
    amount: u64,
    deposit_note_commitment: [u8; 32],
) -> Result<()> {
    // Transfer tokens from vesting vault to shielded pool
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vesting_vault.to_account_info(),
            to: ctx.accounts.shielded_pool_vault.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        &[&[b"vault_authority", &[ctx.bumps.vault_authority]]],
    );
    token::transfer(transfer_ctx, amount)?;

    // Register deposit note with Radr
    radr_sdk::cpi::register_deposit(
        ctx.accounts.into_radr_context(),
        DepositNote {
            commitment: deposit_note_commitment,
            amount, // This gets encrypted by Radr
            asset: ctx.accounts.token_mint.key(),
        },
    )?;

    emit!(ShieldedWithdrawal {
        nullifier: ctx.accounts.nullifier.key(),
        commitment: deposit_note_commitment,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ShieldWithdrawal<'info> {
    #[account(mut)]
    pub withdrawer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vesting_vault", token_mint.key().as_ref()],
        bump,
    )]
    pub vesting_vault: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    /// CHECK: PDA authority
    pub vault_authority: AccountInfo<'info>,

    /// Radr shielded pool vault
    #[account(mut)]
    pub shielded_pool_vault: Account<'info, TokenAccount>,

    /// Radr shielded pool state
    #[account(mut)]
    pub shielded_pool: Account<'info, ShieldedPool>,

    /// Nullifier to prevent double-withdrawal
    #[account(
        init,
        payer = withdrawer,
        space = 8 + 32,
        seeds = [b"nullifier", nullifier_hash.as_ref()],
        bump,
    )]
    pub nullifier: Account<'info, NullifierAccount>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub radr_program: Program<'info, Radr>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct NullifierAccount {
    pub hash: [u8; 32],
}

#[event]
pub struct ShieldedWithdrawal {
    pub nullifier: Pubkey,
    pub commitment: [u8; 32],
    pub timestamp: i64,
}
```

---

## 6. Layer 5: ECDH Stealth Addresses - Receiver Privacy

> **Documentation Links:**
> - [EIP-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564) - Ethereum stealth address standard
> - [Vitalik's Stealth Address Guide](https://vitalik.eth.limo/general/2023/01/20/stealth.html) - Conceptual explanation
> - [GhostSol/Zera Privacy SDK](https://github.com/jskoiz/zeraprivacy) - Solana stealth implementation
> - [Solana Token-2022 Confidential Transfers](https://spl.solana.com/confidential-token/deep-dive/zkps) - Native privacy
> - [@noble/curves (Ed25519)](https://github.com/paulmillr/noble-curves) - Cryptographic primitives
> - [@noble/hashes](https://github.com/paulmillr/noble-hashes) - Hash functions (SHA512)
> - [ECDH Explained](https://cryptobook.nakov.com/asymmetric-key-ciphers/ecdh-key-exchange) - Key exchange theory
> - [Umbra Protocol](https://app.umbra.cash/) - Ethereum stealth payments reference

### 6.1 Purpose

Generate one-time addresses for every payment to break on-chain linkability:
- **Receiver Privacy** - Each payment goes to a unique, unlinkable address
- **No Address Reuse** - Prevents transaction graph analysis
- **Self-Custody** - Only recipient can derive private key to spend

### 6.2 Why Stealth Addresses Are Needed

Radr Labs ShadowPay hides **amounts** but not **receiver addresses**. Without stealth addresses:

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

### 6.3 Stealth Address Cryptography

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

### 6.4 Stealth Address Implementation

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

### 6.5 On-Chain Stealth Registry

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

### 6.6 Stealth Address Flow Diagram

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

---

## 7. Data Models & State

> **Documentation Links:**
> - [Anchor Account Constraints](https://www.anchor-lang.com/docs/account-constraints) - Account validation
> - [Anchor Account Types](https://docs.rs/anchor-lang/latest/anchor_lang/accounts/index.html) - Rust account types
> - [Solana Account Model](https://solana.com/docs/core/accounts) - How Solana accounts work
> - [PDAs (Program Derived Addresses)](https://solana.com/docs/core/pda) - Deterministic addresses
> - [SPL Token Accounts](https://spl.solana.com/token) - Token account structure

### 7.1 Account Types

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

### 7.2 State Transitions

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
│   │ PARTIAL  │  │ CLAIMED  │  │ SHIELDED │                   │
│   │ CLAIM    │  │ (direct) │  │ (via Radr)│                   │
│   └──────────┘  └──────────┘  └──────────┘                   │
│                                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Implementation Phases

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

### Phase 2: Light Protocol Integration (Week 3)

**Goal**: Compressed vesting positions

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| Set up Light Protocol SDK | HIGH | Phase 1 | [Installation](https://www.zkcompression.com/introduction/installation) |
| Implement compressed position creation | HIGH | Light SDK | [Create Compressed Accounts](https://www.zkcompression.com/compressed-pdas/guides/how-to-create-compressed-accounts) |
| Implement Merkle proof verification | HIGH | Compressed positions | [Merkle Trees](https://www.zkcompression.com/learn/core-concepts/merkle-trees-validity-proofs) |
| State migration strategy | MEDIUM | All above | [Account Model](https://www.zkcompression.com/learn/core-concepts/compressed-account-model) |
| Integration tests | HIGH | All above | [Client Guide](https://www.zkcompression.com/client-library/client-guide) |

**Deliverables**:
- Light Protocol integration
- Compressed vesting positions
- Cost benchmarks

### Phase 3: Noir ZK Circuits (Week 4)

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

### Phase 4: Radr Integration (Week 5)

**Goal**: Shielded settlement

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| Integrate Radr SDK | HIGH | Phase 3 | [@shadowpay/server](https://www.npmjs.com/package/@shadowpay/server) |
| Implement shielded withdrawal | HIGH | Radr SDK | [ShadowPay API](https://registry.scalar.com/@radr/apis/shadowpay-api) |
| Test with Radr testnet | HIGH | Implementation | [Radr Labs](https://www.radrlabs.io/) |
| MEV protection validation | MEDIUM | All above | [ShadowPay Docs](https://www.radrlabs.io/docs) |

**Deliverables**:
- Radr Labs integration
- Full withdrawal flow
- Privacy guarantees documentation

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

### Phase 6: Stealth Addresses (Week 7)

**Goal**: Complete receiver privacy with ECDH stealth addresses

| Task | Priority | Dependencies | Docs |
|------|----------|--------------|------|
| Implement stealth meta-address registry | HIGH | Phase 1 | [EIP-5564](https://eips.ethereum.org/EIPS/eip-5564) |
| ECDH key generation (TypeScript) | HIGH | None | [@noble/curves](https://github.com/paulmillr/noble-curves) |
| Stealth address derivation | HIGH | ECDH keys | [Vitalik's Guide](https://vitalik.eth.limo/general/2023/01/20/stealth.html) |
| Payment scanning service | HIGH | Stealth addresses | [Solana Websocket](https://solana.com/docs/rpc/websocket) |
| Private key recovery for spending | HIGH | Scanning | [Ed25519 Arithmetic](https://ed25519.cr.yp.to/) |
| Integration with Radr settlement | HIGH | Phase 4 | [ShadowPay API](https://registry.scalar.com/@radr/apis/shadowpay-api) |

**Deliverables**:
- `stealth_registry.rs` - On-chain stealth meta-address storage
- `lib/stealth-address.ts` - Client-side ECDH implementation
- Employee scanning interface

---

## 9. Directory Structure

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
│   │           ├── light_integration.rs  # Light Protocol
│   │           ├── radr_integration.rs   # Radr Labs ShadowPay
│   │           ├── stealth_registry.rs   # ECDH Stealth addresses
│   │           └── errors.rs
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

## 10. Security Considerations

> **Documentation Links:**
> - [Solana Security Best Practices](https://solana.com/docs/programs#security) - Program security
> - [Anchor Security](https://www.anchor-lang.com/docs/common-security-exploits) - Common exploits
> - [Sealevel Attacks](https://github.com/coral-xyz/sealevel-attacks) - Solana vulnerability examples
> - [ZK Circuit Security](https://www.rareskills.io/post/zk-security) - ZK proof pitfalls
> - [OWASP Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/) - Crypto security
> - [MPC Security Considerations](https://docs.arcium.com/learn/security) - Arcium security model
> - [Groth16 Security](https://eprint.iacr.org/2016/260.pdf) - ZK-SNARK security paper

### 10.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| **Salary disclosure** | Arcium MPC encryption + Light compression |
| **Withdrawal tracing** | Radr shielded pools + ZK nullifiers |
| **Double withdrawal** | Nullifier registry + Merkle proofs |
| **Identity linkage** | Pedersen commitments + ZK identity proofs |
| **Receiver address reuse** | ECDH Stealth addresses (Layer 5) |
| **MEV attacks** | Radr MEV protection + private mempools |
| **Oracle manipulation** | On-chain timestamps only |
| **Key compromise** | Separate spend/view keys for stealth |
| **Metadata leakage** | Encrypted memos + timing obfuscation |

### 10.2 Privacy Layer Comparison

| Layer | Hides Amount | Hides Sender | Hides Receiver | Hides Timing |
|-------|--------------|--------------|----------------|--------------|
| Light Protocol | ❌ | ❌ | ❌ | ❌ |
| Arcium MPC | ✅ | ❌ | ❌ | ❌ |
| Noir ZK | ✅ | ✅ | ❌ | ❌ |
| Radr ShadowPay | ✅ | ✅ | ⚠️ Partial | ⚠️ Partial |
| Stealth Addresses | ❌ | ❌ | ✅ | ❌ |
| **Combined** | ✅ | ✅ | ✅ | ⚠️ Partial |

### 10.3 Audit Checklist

- [ ] Arcium encryption key management
- [ ] Merkle tree integrity
- [ ] Nullifier uniqueness
- [ ] ZK circuit soundness
- [ ] Radr integration security
- [ ] Stealth address ECDH correctness
- [ ] View key scanning privacy
- [ ] Access control validation

---

## 11. Sources & References

### Light Protocol (ZK Compression)
- [Light Protocol Documentation](https://www.zkcompression.com)
- [Light Protocol GitHub](https://github.com/Lightprotocol/light-protocol)
- [Compressed Accounts Guide](https://www.zkcompression.com/compressed-pdas/guides/how-to-create-compressed-accounts)
- [Merkle Trees & Validity Proofs](https://www.zkcompression.com/learn/core-concepts/merkle-trees-validity-proofs)

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

### Radr Labs ShadowPay
- [Radr Labs Website](https://www.radrlabs.io/)
- [ShadowPay API Reference](https://registry.scalar.com/@radr/apis/shadowpay-api)
- [ShadowID Documentation](https://www.radrlabs.io/docs/shadowid)
- [@shadowpay/server NPM Package](https://www.npmjs.com/package/@shadowpay/server)
- **Key Concepts**:
  - ElGamal encryption on BN254 curve
  - Groth16 ZK-SNARKs for verification
  - Bitmap-based nullifiers
  - Relayer infrastructure for sender anonymity

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

## 12. Decision Matrix: Radr Labs vs Custom Stealth

| Requirement | Radr Labs | Custom Stealth | Recommendation |
|-------------|-----------|----------------|----------------|
| Amount privacy | ✅ Built-in | ❌ Not included | Use Radr |
| Receiver privacy | ❌ Not included | ✅ Full stealth | Build custom |
| Relayer infra | ✅ Ready to use | ❌ Must build | Use Radr |
| SDK maturity | ✅ Production | ⚠️ Custom code | Use Radr |
| Full privacy | ⚠️ Partial | ✅ When combined | **Hybrid** |

**Recommendation**: Use both Radr Labs (for amount privacy + relayers) AND custom ECDH stealth addresses (for receiver privacy). This hybrid approach provides complete privacy coverage.

---

*Generated for ShadowVest MVP - Privacy-First Payroll Protocol*
