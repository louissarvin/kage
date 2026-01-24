use std::hash::poseidon;

/// ShadowVest Eligibility Circuit
///
/// A lightweight pre-check circuit that proves three properties:
/// 1. The caller knows the identity_secret behind a beneficiary_commitment
/// 2. The nullifier was correctly derived (prevents double-claims)
/// 3. The caller's identity is bound to a specific vesting position
///
/// This circuit serves as the entry gate before the full withdrawal flow:
///   eligibility_proof -> Arcium MPC computation -> withdrawal_proof -> settlement
///
/// It is simpler and cheaper to prove than the full withdrawal_proof circuit,
/// making it suitable for:
/// - Quick eligibility checks before initiating MPC computation
/// - Client-side pre-validation to avoid wasted MPC fees
/// - Compliance attestations (prove you have a position without revealing details)
///
/// The on-chain verification currently uses Ed25519 stealth signatures (native Solana).
/// When a production Noir verifier for Solana exists, this circuit can be
/// verified on-chain directly, replacing the Ed25519 check.
///
/// Privacy guarantees:
/// - The stealth address (beneficiary_commitment) is unlinkable to the employee
/// - The nullifier prevents double-claims without revealing who claimed
/// - The position_commitment reveals nothing about amount or schedule
///
/// Relationship to other circuits:
/// - withdrawal_proof: Full Merkle-based withdrawal with amount bounds
/// - identity_proof: Position ownership proof with schedule data

fn main(
    // Private inputs
    identity_secret: Field,            // Stealth key material
    vesting_amount: u64,               // Total vesting amount (for position binding)
    // Public inputs
    beneficiary_commitment: pub Field, // Poseidon(identity_secret)
    nullifier: pub Field,              // Poseidon(identity_secret, position_id)
    position_id: pub Field,            // Identifies the vesting position
    position_commitment: pub Field,    // Poseidon(identity_commitment, vesting_amount)
) {
    // Step 1: Verify identity
    // The caller must know the secret behind the on-chain commitment.
    // This proves they are the legitimate beneficiary.
    let computed_commitment = poseidon::bn254::hash_1([identity_secret]);
    assert(
        computed_commitment == beneficiary_commitment,
        "Identity verification failed: secret does not match commitment"
    );

    // Step 2: Verify nullifier derivation
    // The nullifier is deterministically tied to identity + position,
    // ensuring each identity can only claim each position once.
    let computed_nullifier = poseidon::bn254::hash_2([identity_secret, position_id]);
    assert(
        computed_nullifier == nullifier,
        "Nullifier derivation failed: does not match expected value"
    );

    // Step 3: Verify position binding
    // The identity is bound to a specific vesting position via the
    // position_commitment. This ensures the prover cannot claim
    // eligibility for a position that belongs to someone else.
    let identity_commitment = computed_commitment;
    let computed_position = poseidon::bn254::hash_2([
        identity_commitment,
        vesting_amount as Field,
    ]);
    assert(
        computed_position == position_commitment,
        "Position binding failed: identity not bound to this position"
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_valid_eligibility() {
    let secret: Field = 12345;
    let amount: u64 = 50000;
    let pos_id: Field = 1;

    let commitment = poseidon::bn254::hash_1([secret]);
    let null = poseidon::bn254::hash_2([secret, pos_id]);
    let pos_commit = poseidon::bn254::hash_2([commitment, amount as Field]);

    main(secret, amount, commitment, null, pos_id, pos_commit);
}

#[test(should_fail_with = "Identity verification failed: secret does not match commitment")]
fn test_wrong_secret() {
    let secret: Field = 12345;
    let wrong_secret: Field = 99999;
    let amount: u64 = 50000;
    let pos_id: Field = 1;

    let commitment = poseidon::bn254::hash_1([secret]);
    let null = poseidon::bn254::hash_2([secret, pos_id]);
    let pos_commit = poseidon::bn254::hash_2([commitment, amount as Field]);

    // Should fail: wrong secret doesn't produce the correct commitment
    main(wrong_secret, amount, commitment, null, pos_id, pos_commit);
}

#[test(should_fail_with = "Nullifier derivation failed: does not match expected value")]
fn test_wrong_nullifier() {
    let secret: Field = 12345;
    let amount: u64 = 50000;
    let pos_id: Field = 1;

    let commitment = poseidon::bn254::hash_1([secret]);
    let wrong_null = poseidon::bn254::hash_2([secret, 2]); // wrong position_id
    let pos_commit = poseidon::bn254::hash_2([commitment, amount as Field]);

    // Should fail: nullifier derived from wrong position_id
    main(secret, amount, commitment, wrong_null, pos_id, pos_commit);
}

#[test(should_fail_with = "Position binding failed: identity not bound to this position")]
fn test_wrong_position_commitment() {
    let secret: Field = 12345;
    let amount: u64 = 50000;
    let wrong_amount: u64 = 99999;
    let pos_id: Field = 1;

    let commitment = poseidon::bn254::hash_1([secret]);
    let null = poseidon::bn254::hash_2([secret, pos_id]);
    // Position commitment with different amount
    let wrong_pos_commit = poseidon::bn254::hash_2([commitment, wrong_amount as Field]);

    // Should fail: amount mismatch in position commitment
    main(secret, amount, commitment, null, pos_id, wrong_pos_commit);
}

#[test]
fn test_different_positions() {
    // Verify circuit works for multiple distinct positions
    let secret: Field = 42;

    // Position 1: small amount
    let amount_1: u64 = 1000;
    let pos_id_1: Field = 1;
    let commitment = poseidon::bn254::hash_1([secret]);
    let null_1 = poseidon::bn254::hash_2([secret, pos_id_1]);
    let pos_commit_1 = poseidon::bn254::hash_2([commitment, amount_1 as Field]);
    main(secret, amount_1, commitment, null_1, pos_id_1, pos_commit_1);

    // Position 2: large amount, different position_id
    let amount_2: u64 = 1000000;
    let pos_id_2: Field = 2;
    let null_2 = poseidon::bn254::hash_2([secret, pos_id_2]);
    let pos_commit_2 = poseidon::bn254::hash_2([commitment, amount_2 as Field]);
    main(secret, amount_2, commitment, null_2, pos_id_2, pos_commit_2);
}

#[test(should_fail_with = "Position binding failed: identity not bound to this position")]
fn test_cannot_claim_others_position() {
    // Alice's position
    let alice_secret: Field = 111;
    let alice_commitment = poseidon::bn254::hash_1([alice_secret]);
    let amount: u64 = 50000;
    let pos_id: Field = 1;
    let alice_pos_commit = poseidon::bn254::hash_2([alice_commitment, amount as Field]);

    // Bob tries to claim Alice's position
    let bob_secret: Field = 222;
    let bob_null = poseidon::bn254::hash_2([bob_secret, pos_id]);
    let bob_commitment = poseidon::bn254::hash_1([bob_secret]);

    // Should fail: Bob's identity doesn't match Alice's position commitment
    main(bob_secret, amount, bob_commitment, bob_null, pos_id, alice_pos_commit);
}
