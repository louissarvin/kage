use std::hash::poseidon;

/// ShadowVest Identity Proof Circuit
///
/// Proves that the prover is the beneficiary of a specific vesting position
/// without revealing their identity or the position details.
///
/// This circuit is used when an employee needs to prove ownership of a
/// vesting position (e.g., for compliance checks, governance participation,
/// or dispute resolution) without disclosing:
/// - Their actual identity (only a commitment is revealed)
/// - The vesting amount (encrypted in position_data[0])
/// - The vesting schedule (start_time, cliff, duration)
///
/// Privacy properties:
/// - Identity: Hidden behind Poseidon hash commitment
/// - Position details: All 4 fields remain private
/// - Only the position_commitment (already on-chain) is revealed
///
/// Public inputs:
///   position_commitment  - The on-chain commitment to the vesting position
///
/// Private inputs:
///   identity_preimage    - Secret identity value (pre-hash)
///   position_data        - Array of 4 fields:
///                          [0] encrypted_amount - Encrypted vesting amount
///                          [1] start_time       - Vesting start timestamp
///                          [2] cliff            - Cliff period duration
///                          [3] duration         - Total vesting duration
///
/// Commitment construction (tree-structured Poseidon):
///   identity_commitment = Poseidon(identity_preimage)
///   left  = Poseidon(identity_commitment, encrypted_amount)
///   right = Poseidon(start_time, cliff)
///   mid   = Poseidon(duration, 0)  // padded to pair
///   inner = Poseidon(left, right)
///   position_commitment = Poseidon(inner, mid)
///
/// This tree structure uses only hash_2 (2-input Poseidon) which is the
/// most widely supported and optimized variant in Noir's standard library.

fn main(
    // Public input
    position_commitment: pub Field,
    // Private inputs
    identity_preimage: Field,
    position_data: [Field; 4],
) {
    // Step 1: Derive identity commitment from the secret preimage
    // This is the same derivation used when creating the vesting position,
    // ensuring consistency across the protocol.
    let identity_commitment = poseidon::bn254::hash_1([identity_preimage]);

    // Step 2: Rebuild the position commitment using tree-structured hashing
    // We combine 5 values (identity_commitment + 4 position fields) using
    // a binary tree of hash_2 calls. This avoids depending on hash_5 which
    // may not be available in all Noir versions.
    let computed_commitment = compute_position_commitment(
        identity_commitment,
        position_data[0], // encrypted_amount
        position_data[1], // start_time
        position_data[2], // cliff
        position_data[3], // duration
    );

    // Step 3: Assert the computed commitment matches the public input
    // This proves the prover knows the preimage of the on-chain commitment,
    // which means they are the legitimate beneficiary of this position.
    assert(
        computed_commitment == position_commitment,
        "Position commitment mismatch: prover is not the beneficiary"
    );
}

/// Compute position commitment from 5 field elements using tree-structured hashing.
///
/// Tree structure:
///        root
///       /    \
///    inner    mid
///    /   \      \
///  left  right  Poseidon(duration, 0)
///   |      |
/// Poseidon(id, amt)  Poseidon(start, cliff)
///
/// This ensures all 5 inputs contribute to the final commitment while
/// only using the universally-supported hash_2 function.
fn compute_position_commitment(
    identity_commitment: Field,
    encrypted_amount: Field,
    start_time: Field,
    cliff: Field,
    duration: Field,
) -> Field {
    // Level 0: hash pairs of inputs
    let left = poseidon::bn254::hash_2([identity_commitment, encrypted_amount]);
    let right = poseidon::bn254::hash_2([start_time, cliff]);
    // Pad the odd element (duration) with a domain separator (0) to form a pair
    let mid = poseidon::bn254::hash_2([duration, 0]);

    // Level 1: combine left and right
    let inner = poseidon::bn254::hash_2([left, right]);

    // Level 2: final root
    poseidon::bn254::hash_2([inner, mid])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_valid_identity_proof() {
    // Setup: create a position and prove ownership
    let secret: Field = 77;
    let encrypted_amount: Field = 50000;
    let start_time: Field = 1700000000;
    let cliff: Field = 2592000;     // 30 days in seconds
    let duration: Field = 31536000; // 365 days in seconds

    let pos_data: [Field; 4] = [encrypted_amount, start_time, cliff, duration];

    // Derive identity commitment
    let id_commit = poseidon::bn254::hash_1([secret]);

    // Compute position commitment using the same tree structure
    let pos_commit = compute_position_commitment(
        id_commit,
        pos_data[0],
        pos_data[1],
        pos_data[2],
        pos_data[3],
    );

    // Prove ownership - should pass
    main(pos_commit, secret, pos_data);
}

#[test(should_fail_with = "Position commitment mismatch: prover is not the beneficiary")]
fn test_wrong_identity() {
    // Attempt to claim someone else's position
    let real_secret: Field = 77;
    let fake_secret: Field = 88;
    let encrypted_amount: Field = 50000;
    let start_time: Field = 1700000000;
    let cliff: Field = 2592000;
    let duration: Field = 31536000;

    let pos_data: [Field; 4] = [encrypted_amount, start_time, cliff, duration];

    // Compute commitment with real identity
    let real_id_commit = poseidon::bn254::hash_1([real_secret]);
    let pos_commit = compute_position_commitment(
        real_id_commit,
        pos_data[0],
        pos_data[1],
        pos_data[2],
        pos_data[3],
    );

    // Try to prove with fake identity - should fail
    main(pos_commit, fake_secret, pos_data);
}

#[test(should_fail_with = "Position commitment mismatch: prover is not the beneficiary")]
fn test_wrong_position_data() {
    // Correct identity but wrong position data
    let secret: Field = 77;
    let encrypted_amount: Field = 50000;
    let start_time: Field = 1700000000;
    let cliff: Field = 2592000;
    let duration: Field = 31536000;

    let real_pos_data: [Field; 4] = [encrypted_amount, start_time, cliff, duration];

    // Compute commitment with real data
    let id_commit = poseidon::bn254::hash_1([secret]);
    let pos_commit = compute_position_commitment(
        id_commit,
        real_pos_data[0],
        real_pos_data[1],
        real_pos_data[2],
        real_pos_data[3],
    );

    // Attempt with modified amount
    let fake_pos_data: [Field; 4] = [99999, start_time, cliff, duration];

    // Should fail: position data doesn't match commitment
    main(pos_commit, secret, fake_pos_data);
}

#[test]
fn test_different_vesting_schedules() {
    // Verify circuit works with various schedule parameters
    let secret: Field = 123;

    // Short vesting: 7 day cliff, 90 day duration
    let pos_data_short: [Field; 4] = [10000, 1700000000, 604800, 7776000];
    let id_commit = poseidon::bn254::hash_1([secret]);
    let commit_short = compute_position_commitment(
        id_commit,
        pos_data_short[0],
        pos_data_short[1],
        pos_data_short[2],
        pos_data_short[3],
    );
    main(commit_short, secret, pos_data_short);

    // Long vesting: 365 day cliff, 1460 day (4yr) duration
    let pos_data_long: [Field; 4] = [1000000, 1700000000, 31536000, 126144000];
    let commit_long = compute_position_commitment(
        id_commit,
        pos_data_long[0],
        pos_data_long[1],
        pos_data_long[2],
        pos_data_long[3],
    );
    main(commit_long, secret, pos_data_long);
}

#[test(should_fail_with = "Position commitment mismatch: prover is not the beneficiary")]
fn test_tampered_schedule() {
    // Attempt to prove with modified cliff period
    let secret: Field = 77;
    let encrypted_amount: Field = 50000;
    let start_time: Field = 1700000000;
    let cliff: Field = 2592000;
    let duration: Field = 31536000;

    let real_pos_data: [Field; 4] = [encrypted_amount, start_time, cliff, duration];

    let id_commit = poseidon::bn254::hash_1([secret]);
    let pos_commit = compute_position_commitment(
        id_commit,
        real_pos_data[0],
        real_pos_data[1],
        real_pos_data[2],
        real_pos_data[3],
    );

    // Tamper with cliff period (try to claim earlier unlock)
    let tampered_pos_data: [Field; 4] = [encrypted_amount, start_time, 0, duration];

    // Should fail: tampered cliff doesn't match commitment
    main(pos_commit, secret, tampered_pos_data);
}
