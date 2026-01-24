use std::hash::poseidon;

/// ShadowVest Withdrawal Proof Circuit
///
/// Proves that a beneficiary is entitled to withdraw a specific amount from
/// a vesting position without revealing their identity, the vesting amount,
/// or any other private details.
///
/// Privacy properties:
/// - Identity: Hidden via identity_secret (only commitment is public)
/// - Amount: Hidden via withdrawal_commitment (only hash is public)
/// - Position: Hidden via Merkle proof (only root is public)
/// - Replay protection: Nullifier prevents double-withdrawal per epoch
///
/// Public inputs (visible on-chain):
///   state_root             - Merkle root of the vesting state tree
///   epoch_id               - Current epoch identifier for time-locking
///   nullifier              - Unique per identity+epoch, prevents double-claims
///   withdrawal_commitment  - Poseidon hash of the claimed amount
///
/// Private inputs (known only to prover):
///   vesting_amount         - Total vesting amount for this position
///   identity_secret        - Secret key material for identity derivation
///   vesting_path           - Merkle proof siblings (32-level tree)
///   claimed_amount         - Amount the prover wishes to withdraw

fn main(
    // Public inputs
    state_root: pub Field,
    epoch_id: pub u64,
    nullifier: pub Field,
    withdrawal_commitment: pub Field,
    // Private inputs
    vesting_amount: u64,
    identity_secret: Field,
    vesting_path: [Field; 32],
    claimed_amount: u64,
) {
    // Step 1: Derive identity commitment from secret
    // The identity_commitment is the public identifier for this beneficiary,
    // derived deterministically from the secret. An observer cannot reverse
    // this to learn identity_secret.
    let identity_commitment = poseidon::bn254::hash_1([identity_secret]);

    // Step 2: Compute vesting position leaf
    // The leaf encodes both who the position belongs to and the total amount.
    // This is what gets inserted into the Merkle tree when a vesting position
    // is created.
    let position_leaf = poseidon::bn254::hash_2([
        identity_commitment,
        vesting_amount as Field,
    ]);

    // Step 3: Verify Merkle proof - position exists in the state tree
    // Walk up the tree from the leaf, hashing with each sibling on the path.
    // The resulting root must match the public state_root.
    let computed_root = compute_merkle_root(position_leaf, vesting_path);
    assert(computed_root == state_root, "Merkle proof verification failed: position not in state tree");

    // Step 4: Verify nullifier derivation
    // The nullifier is deterministically derived from identity_secret + epoch_id.
    // This ensures each identity can only claim once per epoch, without revealing
    // which identity is claiming.
    let epoch_field = epoch_id as Field;
    let expected_nullifier = poseidon::bn254::hash_2([identity_secret, epoch_field]);
    assert(expected_nullifier == nullifier, "Nullifier derivation mismatch");

    // Step 5: Verify claimed amount does not exceed vested amount
    // In the MVP, we check claimed_amount <= vesting_amount directly.
    // A production version would compute the vested amount based on
    // elapsed time, cliff, and duration parameters.
    assert(claimed_amount as u64 <= vesting_amount as u64, "Claimed amount exceeds vesting amount");

    // Step 6: Verify withdrawal commitment
    // The withdrawal_commitment is a hiding commitment to the claimed amount.
    // This allows the on-chain program to record what was claimed without
    // revealing the actual amount.
    let expected_commitment = poseidon::bn254::hash_1([claimed_amount as Field]);
    assert(expected_commitment == withdrawal_commitment, "Withdrawal commitment mismatch");
}

/// Compute Merkle root from a leaf and a 32-level proof path.
///
/// This function iteratively hashes the current node with each sibling
/// in the path, walking from the leaf up to the root. For the MVP,
/// we assume left-placement of the current node at each level.
///
/// In a production implementation, an additional `path_indices` array
/// would indicate whether the current node is the left or right child
/// at each level of the tree.
fn compute_merkle_root(leaf: Field, path: [Field; 32]) -> Field {
    let mut current = leaf;
    for i in 0..32 {
        current = poseidon::bn254::hash_2([current, path[i]]);
    }
    current
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_valid_withdrawal_proof() {
    // Setup: create a valid vesting position and prove withdrawal
    let secret: Field = 42;
    let amount: u64 = 1000;
    let claim: u64 = 500;
    let epoch: u64 = 1;

    // Derive identity commitment
    let id_commitment = poseidon::bn254::hash_1([secret]);

    // Compute position leaf
    let leaf = poseidon::bn254::hash_2([id_commitment, amount as Field]);

    // Build a trivial Merkle path (all zeros for sibling nodes)
    let mut path: [Field; 32] = [0; 32];

    // Compute the expected root by walking up the tree
    let mut expected_root = leaf;
    for i in 0..32 {
        expected_root = poseidon::bn254::hash_2([expected_root, path[i]]);
    }

    // Derive nullifier
    let null = poseidon::bn254::hash_2([secret, epoch as Field]);

    // Derive withdrawal commitment
    let w_commit = poseidon::bn254::hash_1([claim as Field]);

    // This should pass
    main(expected_root, epoch, null, w_commit, amount, secret, path, claim);
}

#[test]
fn test_full_amount_withdrawal() {
    // Withdraw the entire vesting amount
    let secret: Field = 99;
    let amount: u64 = 5000;
    let claim: u64 = 5000; // claiming full amount
    let epoch: u64 = 10;

    let id_commitment = poseidon::bn254::hash_1([secret]);
    let leaf = poseidon::bn254::hash_2([id_commitment, amount as Field]);

    let path: [Field; 32] = [0; 32];
    let mut expected_root = leaf;
    for i in 0..32 {
        expected_root = poseidon::bn254::hash_2([expected_root, path[i]]);
    }

    let null = poseidon::bn254::hash_2([secret, epoch as Field]);
    let w_commit = poseidon::bn254::hash_1([claim as Field]);

    main(expected_root, epoch, null, w_commit, amount, secret, path, claim);
}

#[test(should_fail_with = "Claimed amount exceeds vesting amount")]
fn test_overclaim_rejected() {
    // Attempt to claim more than vested - should fail
    let secret: Field = 42;
    let amount: u64 = 1000;
    let claim: u64 = 1001; // exceeds vesting_amount
    let epoch: u64 = 1;

    let id_commitment = poseidon::bn254::hash_1([secret]);
    let leaf = poseidon::bn254::hash_2([id_commitment, amount as Field]);

    let path: [Field; 32] = [0; 32];
    let mut expected_root = leaf;
    for i in 0..32 {
        expected_root = poseidon::bn254::hash_2([expected_root, path[i]]);
    }

    let null = poseidon::bn254::hash_2([secret, epoch as Field]);
    let w_commit = poseidon::bn254::hash_1([claim as Field]);

    main(expected_root, epoch, null, w_commit, amount, secret, path, claim);
}

#[test(should_fail_with = "Nullifier derivation mismatch")]
fn test_wrong_epoch_nullifier() {
    // Nullifier derived from wrong epoch - should fail
    let secret: Field = 42;
    let amount: u64 = 1000;
    let claim: u64 = 500;
    let epoch: u64 = 1;
    let wrong_epoch: u64 = 2;

    let id_commitment = poseidon::bn254::hash_1([secret]);
    let leaf = poseidon::bn254::hash_2([id_commitment, amount as Field]);

    let path: [Field; 32] = [0; 32];
    let mut expected_root = leaf;
    for i in 0..32 {
        expected_root = poseidon::bn254::hash_2([expected_root, path[i]]);
    }

    // Nullifier derived from wrong epoch
    let wrong_null = poseidon::bn254::hash_2([secret, wrong_epoch as Field]);
    let w_commit = poseidon::bn254::hash_1([claim as Field]);

    main(expected_root, epoch, wrong_null, w_commit, amount, secret, path, claim);
}

#[test(should_fail_with = "Merkle proof verification failed: position not in state tree")]
fn test_wrong_merkle_root() {
    // Wrong state root - should fail
    let secret: Field = 42;
    let amount: u64 = 1000;
    let claim: u64 = 500;
    let epoch: u64 = 1;

    let id_commitment = poseidon::bn254::hash_1([secret]);
    let leaf = poseidon::bn254::hash_2([id_commitment, amount as Field]);

    let path: [Field; 32] = [0; 32];

    // Use an incorrect root
    let wrong_root: Field = 12345;

    let null = poseidon::bn254::hash_2([secret, epoch as Field]);
    let w_commit = poseidon::bn254::hash_1([claim as Field]);

    main(wrong_root, epoch, null, w_commit, amount, secret, path, claim);
}

#[test(should_fail_with = "Withdrawal commitment mismatch")]
fn test_wrong_withdrawal_commitment() {
    // Wrong withdrawal commitment - should fail
    let secret: Field = 42;
    let amount: u64 = 1000;
    let claim: u64 = 500;
    let epoch: u64 = 1;

    let id_commitment = poseidon::bn254::hash_1([secret]);
    let leaf = poseidon::bn254::hash_2([id_commitment, amount as Field]);

    let path: [Field; 32] = [0; 32];
    let mut expected_root = leaf;
    for i in 0..32 {
        expected_root = poseidon::bn254::hash_2([expected_root, path[i]]);
    }

    let null = poseidon::bn254::hash_2([secret, epoch as Field]);
    // Commitment to a different amount
    let wrong_commit = poseidon::bn254::hash_1([999 as Field]);

    main(expected_root, epoch, null, wrong_commit, amount, secret, path, claim);
}
