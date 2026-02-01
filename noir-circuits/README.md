# Kage Noir Circuits

**Zero-Knowledge Proof Circuits for Privacy-Preserving Vesting**

This folder contains three Noir circuits that enable privacy features in the Kage protocol. These circuits allow users to prove statements about their vesting positions without revealing sensitive information.

## Overview

| Circuit | Purpose | Complexity |
|---------|---------|------------|
| `eligibility` | Pre-check before MPC computation | Lightweight |
| `identity_proof` | Prove position ownership | Medium |
| `withdrawal_proof` | Full withdrawal with Merkle proof | Advanced |

## Prerequisites

- [Noir](https://noir-lang.org/docs/getting_started/installation) (nargo v0.30+)
- [Barretenberg](https://github.com/AztecProtocol/barretenberg) (for proof generation)

```bash
# Install Noir
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup

# Verify installation
nargo --version
```

## Circuits

### 1. Eligibility Circuit

**Location:** `eligibility/`

A lightweight pre-check circuit that verifies:
1. Caller knows the identity secret behind a beneficiary commitment
2. Nullifier was correctly derived (prevents double-claims)
3. Caller's identity is bound to the specific vesting position

**Use Cases:**
- Quick eligibility checks before initiating MPC computation
- Client-side pre-validation to avoid wasted MPC fees
- Compliance attestations (prove you have a position without revealing details)

**Public Inputs:**
```noir
beneficiary_commitment: Field  // Poseidon(identity_secret)
nullifier: Field               // Poseidon(identity_secret, position_id)
position_id: Field             // Identifies the vesting position
position_commitment: Field     // Poseidon(identity_commitment, vesting_amount)
```

**Private Inputs:**
```noir
identity_secret: Field         // Stealth key material
vesting_amount: u64            // Total vesting amount
```

**Build & Test:**
```bash
cd eligibility
nargo compile
nargo test
```

---

### 2. Identity Proof Circuit

**Location:** `identity_proof/`

Proves that the prover is the beneficiary of a specific vesting position without revealing their identity or position details.

**Use Cases:**
- Compliance checks (prove employment without revealing salary)
- Governance participation (prove you're a stakeholder)
- Dispute resolution (prove position ownership)

**Privacy Properties:**
- Identity: Hidden behind Poseidon hash commitment
- Position details: All 4 fields remain private
- Only the position_commitment (already on-chain) is revealed

**Public Inputs:**
```noir
position_commitment: Field     // On-chain commitment to the vesting position
```

**Private Inputs:**
```noir
identity_preimage: Field       // Secret identity value (pre-hash)
position_data: [Field; 4]      // [encrypted_amount, start_time, cliff, duration]
```

**Commitment Structure (Tree-Structured Poseidon):**
```
        position_commitment
              /    \
          inner      mid
          /   \        \
       left   right   Poseidon(duration, 0)
         |      |
Poseidon(id, amt)  Poseidon(start, cliff)
```

**Build & Test:**
```bash
cd identity_proof
nargo compile
nargo test
```

---

### 3. Withdrawal Proof Circuit

**Location:** `withdrawal_proof/`

Full Merkle-based withdrawal proof that verifies:
1. Position exists in the state tree (Merkle proof)
2. Nullifier is correctly derived (replay protection)
3. Claimed amount doesn't exceed vested amount
4. Withdrawal commitment matches claimed amount

**Use Cases:**
- Full withdrawal verification
- Streaming payment claims
- Partial vesting withdrawals

**Privacy Properties:**
- Identity: Hidden via identity_secret
- Amount: Hidden via withdrawal_commitment
- Position: Hidden via Merkle proof (only root is public)
- Replay protection: Nullifier prevents double-withdrawal per epoch

**Public Inputs:**
```noir
state_root: Field              // Merkle root of the vesting state tree
epoch_id: u64                  // Current epoch identifier
nullifier: Field               // Unique per identity+epoch
withdrawal_commitment: Field   // Poseidon(claimed_amount)
```

**Private Inputs:**
```noir
vesting_amount: u64            // Total vesting amount
identity_secret: Field         // Secret key material
vesting_path: [Field; 32]      // Merkle proof siblings (32-level tree)
claimed_amount: u64            // Amount to withdraw
```

**Merkle Tree:**
- 32-level binary tree
- Poseidon bn254 hashing at each level
- Supports 2^32 vesting positions

**Build & Test:**
```bash
cd withdrawal_proof
nargo compile
nargo test
```

---

## Integration with Kage Protocol

### Current Flow (MVP)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │────▶│   Backend   │────▶│   Solana    │
│             │     │             │     │  Contract   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │
      │  Generate         │                   │
      │  eligibility      │  Verify           │
      │  proof            │  Ed25519 sig      │
      │  (client-side)    │                   │
      ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    Noir     │     │   Arcium    │     │    Light    │
│  Circuits   │     │    MPC      │     │  Protocol   │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Future Flow (On-Chain Verification)

When Sunspot (Noir verifier for Solana) is production-ready:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │────▶│   Solana    │────▶│   Sunspot   │
│             │     │  Contract   │     │  Verifier   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │
      │  Generate         │  Submit           │  Verify
      │  ZK proof         │  proof            │  on-chain
      │  (client-side)    │  on-chain         │
      ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│              Noir Proof Verification                 │
│  • No Ed25519 signature needed                       │
│  • Fully trustless verification                      │
│  • Lower gas costs (no MPC callback)                 │
└─────────────────────────────────────────────────────┘
```

---

## Cryptographic Primitives

### Poseidon Hash (bn254)

All circuits use Poseidon hashing over the BN254 curve:

```noir
use std::hash::poseidon;

// Single input
let commitment = poseidon::bn254::hash_1([secret]);

// Two inputs
let nullifier = poseidon::bn254::hash_2([secret, position_id]);
```

**Why Poseidon?**
- ZK-friendly (low constraint count)
- Widely supported in Noir
- Secure for commitment schemes

### Nullifier Derivation

Nullifiers prevent double-claims:

```noir
// Per-position nullifier (eligibility)
nullifier = Poseidon(identity_secret, position_id)

// Per-epoch nullifier (withdrawal)
nullifier = Poseidon(identity_secret, epoch_id)
```

### Commitment Schemes

**Identity Commitment:**
```noir
identity_commitment = Poseidon(identity_secret)
```

**Position Commitment:**
```noir
position_commitment = Poseidon(identity_commitment, vesting_amount)
```

**Withdrawal Commitment:**
```noir
withdrawal_commitment = Poseidon(claimed_amount)
```

---

## Testing

Run all tests:
```bash
# Test each circuit
cd eligibility && nargo test
cd ../identity_proof && nargo test
cd ../withdrawal_proof && nargo test
```

**Test Coverage:**
- Valid proofs pass
- Wrong secrets fail
- Wrong nullifiers fail
- Tampered data fails
- Overclaims fail
- Wrong Merkle roots fail

---

## Proof Generation

### Generate Proof (CLI)

```bash
cd eligibility

# Edit Prover.toml with your inputs
nargo execute

# Generate proof
nargo prove

# Verify proof
nargo verify
```

### Generate Proof (JavaScript)

```typescript
import { Noir } from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';

// Load compiled circuit
const circuit = await import('./target/eligibility.json');
const backend = new BarretenbergBackend(circuit);
const noir = new Noir(circuit, backend);

// Generate proof
const proof = await noir.generateProof({
  identity_secret: "12345",
  vesting_amount: "50000",
  beneficiary_commitment: "...",
  nullifier: "...",
  position_id: "1",
  position_commitment: "..."
});

// Verify proof
const isValid = await noir.verifyProof(proof);
```

---

## Security Considerations

1. **Identity Secret:** Must be securely generated and stored (derived from stealth keys)
2. **Nullifier Uniqueness:** Each position/epoch combination produces unique nullifier
3. **Commitment Binding:** Tree-structured hashing prevents partial preimage attacks
4. **Merkle Depth:** 32 levels supports billions of positions

---

## Resources

- [Noir Documentation](https://noir-lang.org/docs/)
- [Noir Examples on Solana](https://github.com/solana-foundation/noir-examples)
- [Sunspot Verifier](https://github.com/reilabs/sunspot)
- [Poseidon Hash Specification](https://eprint.iacr.org/2019/458.pdf)

---

## License

MIT
