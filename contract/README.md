# Kage Contract

**Solana Smart Contract for Kage Protocol**

An Anchor-based smart contract integrating Light Protocol (ZK compression), Arcium MPC (confidential computation), Noir ZK proofs (Groth16), and stealth addresses for privacy-preserving payroll and vesting.

## Tech Stack

- **Anchor Framework** - Solana smart contract framework
- **Light Protocol SDK** - ZK compressed accounts (5000x cost reduction)
- **Arcium** - MPC confidential computation for encrypted amounts
- **Noir + Barretenberg** - ZK proofs (Groth16) for claim verification
- **Ed25519** - Signature verification for claims
- **Stealth Addresses** - ECDH-based recipient privacy

## Program ID

| Network | Address |
|---------|---------|
| Devnet | `3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA` |

## Features

### Organizations
- Create organizations with token vaults
- Configure vesting schedules
- Manage compressed position counts

### Vesting Positions
- **Compressed positions** via Light Protocol (5000x cost reduction)
- **Encrypted amounts** via Arcium MPC
- **Stealth recipients** via ECDH addresses

### Claims
- Ed25519 signature verification
- Nullifier-based double-claim prevention
- MPC-verified vesting calculations

### Arcium MPC Circuits
- `init_position` - Initialize encrypted position
- `calculate_vested` - Compute vested amount
- `process_claim` - Verify and process claims
- `store_meta_keys` - Store stealth keys in vault
- `fetch_meta_keys` - Retrieve stealth keys

### Noir ZK Circuits (Groth16)
- `withdrawal_proof` - Proves withdrawal entitlement without revealing amounts
- `identity_proof` - Proves ownership of a vesting position
- `eligibility` - Lightweight pre-check for claim eligibility

## Project Structure

```
contract/
├── programs/
│   └── contract/
│       └── src/
│           ├── lib.rs              # Main program
│           ├── state.rs            # Account structures
│           ├── errors.rs           # Error definitions
│           └── groth16_verifier.rs # On-chain Groth16 verification
├── encrypted-ixs/                  # Arcium MPC circuits
│   ├── init_position.rs
│   ├── calculate_vested.rs
│   ├── process_claim.rs
│   ├── store_meta_keys.rs
│   └── fetch_meta_keys.rs
├── lib/                            # TypeScript libraries
│   ├── noir-proof-generator.ts     # Noir ZK proof generation
│   └── poseidon-bn254.ts           # Poseidon hash for commitments
├── tests/                          # Integration tests
├── scripts/                        # Deployment & utility scripts
├── Anchor.toml                     # Anchor config
└── Arcium.toml                     # Arcium config
```

## Getting Started

### Prerequisites

- Rust 1.70+
- Solana CLI 1.18+
- Anchor CLI 0.32+
- Noir 0.36+ (for ZK circuits)
- Yarn or npm

### Build

```bash
# Install dependencies
yarn install

# Build the Solana program
anchor build

# Build Arcium MPC circuits
arcium build

# Compile Noir circuits (if modifying)
cd noir-circuits && nargo compile
```

### Test

```bash
# Run all tests
anchor test

# Run specific test
anchor test -- --grep "create position"
```

### Deploy

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# Initialize computation definitions (required once)
yarn run ts-node scripts/init-comp-defs.ts
```

## Account Structures

### Organization
```rust
pub struct Organization {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub position_count: u64,
    pub compressed_position_count: u64,
    pub total_allocated: u64,
    pub bump: u8,
}
```

### CompressedVestingPosition
```rust
pub struct CompressedVestingPosition {
    pub owner: Pubkey,
    pub organization: Pubkey,
    pub schedule: Pubkey,
    pub position_id: u64,
    pub beneficiary_commitment: Pubkey,  // Stealth address
    pub encrypted_total_amount: [u8; 16],
    pub encrypted_claimed_amount: [u8; 16],
    pub nonce: u128,
    pub start_timestamp: i64,
    pub is_active: u8,
    pub is_fully_claimed: u8,
}
```

### MetaKeysVault
```rust
pub struct MetaKeysVault {
    pub owner: Pubkey,
    pub encrypted_spend_key: [u8; 80],
    pub encrypted_view_key: [u8; 80],
    pub x25519_pubkey: [u8; 32],
    pub nonce: u128,
    pub is_initialized: bool,
}
```

## Instructions

### Organization Management
- `initialize_organization` - Create new org with vault
- `create_vesting_schedule` - Add vesting schedule

### Position Management
- `create_compressed_position` - Create compressed position with stealth address
- `authorize_claim_compressed` - Authorize claim with Ed25519 signature
- `process_claim_callback` - Process MPC claim result
- `execute_withdrawal` - Transfer tokens to claimant

### Stealth Keys
- `store_meta_keys` - Store encrypted stealth keys in Arcium
- `read_meta_keys_vault` - Retrieve stealth keys via MPC

## Arcium Integration

The contract uses Arcium MPC for confidential computation:

```rust
#[arcium_program]
pub mod contract {
    // Queue computation to Arcium network
    pub fn process_claim(ctx: Context<ProcessClaim>, ...) -> Result<()> {
        let args = ArgBuilder::new()
            .encrypted_u64(encrypted_total_amount)
            .encrypted_u64(encrypted_claimed_amount)
            .plaintext_u64(current_time)
            .build();

        queue_computation(ctx.accounts, args, callbacks)?;
        Ok(())
    }

    // Receive result from Arcium
    #[arcium_callback(encrypted_ix = "process_claim")]
    pub fn process_claim_callback(
        ctx: Context<ProcessClaimCallback>,
        output: SignedComputationOutputs<ProcessClaimOutput>,
    ) -> Result<()> {
        // Verify and process the claim
    }
}
```

## Noir ZK Proofs Integration

The contract uses Noir circuits with Groth16 proofs for privacy-preserving claim verification:

### Circuits

| Circuit | Purpose | Public Inputs | Private Inputs |
|---------|---------|---------------|----------------|
| `withdrawal_proof` | Prove withdrawal entitlement | state_root, epoch_id, nullifier, withdrawal_commitment | vesting_amount, identity_secret, merkle_path, claimed_amount |
| `identity_proof` | Prove position ownership | position_commitment | identity_preimage, position_data |
| `eligibility` | Pre-check claim eligibility | beneficiary_commitment, nullifier, position_id, position_commitment | identity_secret, vesting_amount |

### TypeScript Usage

```typescript
import { ShadowVestProver, buildVerifyWithdrawalIx } from './lib/noir-proof-generator';

// Initialize prover with compiled circuits
const prover = new ShadowVestProver();
await prover.initialize({
  withdrawal_proof: withdrawalArtifact,
  identity_proof: identityArtifact,
  eligibility: eligibilityArtifact,
});

// Generate proof
const proof = await prover.generateWithdrawalProof({
  state_root: '0x...',
  epoch_id: 1n,
  nullifier: '0x...',
  withdrawal_commitment: '0x...',
  vesting_amount: 1000000n,
  identity_secret: '0x...',
  vesting_path: [...], // 32 Merkle siblings
  claimed_amount: 500000n,
});

// Build Solana instruction
const { instruction, computeBudgetIx } = buildVerifyWithdrawalIx(
  programId,
  verifier,
  vkAccount,
  proof
);
```

### Commitment Derivation

```typescript
// Identity commitment: Poseidon(identity_secret)
const identityCommitment = await deriveIdentityCommitment(identitySecret);

// Nullifier: Poseidon(identity_secret, epoch_id)
const nullifier = await deriveNullifier(identitySecret, epochId);

// Withdrawal commitment: Poseidon(claimed_amount)
const withdrawalCommitment = await deriveWithdrawalCommitment(claimedAmount);
```

## Light Protocol Integration

Compressed positions use Light Protocol for 5000x cost savings:

```rust
// Create compressed position
let compressed_position = CompressedVestingPosition {
    owner: ctx.accounts.organization.key(),
    beneficiary_commitment: stealth_address,
    encrypted_total_amount,
    // ...
};

// Store via Light Protocol CPI
light_sdk::create_account(compressed_position)?;
```

## Security

- **Nullifiers** prevent double-claims (derived via Poseidon hash)
- **Ed25519 signatures** verify claim authorization
- **Arcium MPC** ensures amounts stay encrypted during computation
- **Noir ZK proofs** verify claims without revealing amounts (Groth16)
- **Light Protocol** provides state compression with ZK proofs
- **Stealth addresses** hide recipient identities via ECDH

## License

MIT
