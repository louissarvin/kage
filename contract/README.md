# Kage Contract

**Solana Smart Contract for Kage Protocol**

An Anchor-based smart contract integrating Light Protocol (ZK compression), Arcium MPC (confidential computation), and stealth addresses for privacy-preserving payroll and vesting.

## Tech Stack

- **Anchor Framework** - Solana smart contract framework
- **Light Protocol SDK** - ZK compressed accounts
- **Arcium** - MPC confidential computation
- **Ed25519** - Signature verification for claims

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

## Project Structure

```
contract/
├── programs/
│   └── contract/
│       └── src/
│           ├── lib.rs           # Main program
│           ├── state.rs         # Account structures
│           ├── errors.rs        # Error definitions
│           └── groth16_verifier.rs  # ZK verification
├── encrypted-ixs/               # Arcium MPC circuits
│   ├── init_position.rs
│   ├── calculate_vested.rs
│   ├── process_claim.rs
│   ├── store_meta_keys.rs
│   └── fetch_meta_keys.rs
├── tests/                       # Integration tests
├── Anchor.toml                  # Anchor config
└── Arcium.toml                  # Arcium config
```

## Getting Started

### Prerequisites

- Rust 1.70+
- Solana CLI 1.18+
- Anchor CLI 0.32+
- Yarn or npm

### Build

```bash
# Build the program
anchor build

# Build Arcium circuits
arcium build
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

- **Nullifiers** prevent double-claims
- **Ed25519 signatures** verify claim authorization
- **Arcium MPC** ensures amounts stay encrypted
- **Light Protocol** provides state compression with ZK proofs

## License

MIT
