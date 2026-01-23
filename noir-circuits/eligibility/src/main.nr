use std::hash::poseidon;

/// ShadowVest Eligibility Circuit
///
/// Proves that the caller knows the identity_secret that maps to a given
/// beneficiary_commitment, and that the nullifier was correctly derived.
///
/// This circuit is compiled and proven off-chain for the MVP.
/// The on-chain verification uses Ed25519 stealth signatures (native Solana).
/// When a production Noir verifier for Solana exists, this circuit can be
/// verified on-chain directly, replacing the Ed25519 check.
///
/// Privacy guarantee: The stealth address (beneficiary_commitment) is already
/// unlinkable to the employee's identity. The nullifier prevents double-claims
/// without revealing who claimed.

fn main(
    identity_secret: Field,                    // Private: stealth key material
    beneficiary_commitment: pub Field,         // Public: Poseidon(identity_secret)
    nullifier: pub Field,                      // Public: Poseidon(identity_secret, position_id)
    position_id: pub Field,                    // Public: identifies the vesting position
) {
    // Verify identity: the caller knows the secret behind the commitment
    let computed_commitment = poseidon::bn254::hash_1([identity_secret]);
    assert(computed_commitment == beneficiary_commitment);

    // Verify nullifier derivation: nullifier is deterministically tied to identity + position
    let computed_nullifier = poseidon::bn254::hash_2([identity_secret, position_id]);
    assert(computed_nullifier == nullifier);
}

#[test]
fn test_valid_proof() {
    // Test with known values
    let secret = 12345;
    let commitment = poseidon::bn254::hash_1([secret]);
    let pos_id = 1;
    let null = poseidon::bn254::hash_2([secret, pos_id]);

    main(secret, commitment, null, pos_id);
}

#[test(should_fail)]
fn test_wrong_secret() {
    let secret = 12345;
    let wrong_secret = 99999;
    let commitment = poseidon::bn254::hash_1([secret]);
    let pos_id = 1;
    let null = poseidon::bn254::hash_2([secret, pos_id]);

    // Should fail: wrong secret doesn't match commitment
    main(wrong_secret, commitment, null, pos_id);
}

#[test(should_fail)]
fn test_wrong_nullifier() {
    let secret = 12345;
    let commitment = poseidon::bn254::hash_1([secret]);
    let pos_id = 1;
    let wrong_null = poseidon::bn254::hash_2([secret, 2]); // wrong position_id

    // Should fail: nullifier derived from wrong position_id
    main(secret, commitment, wrong_null, pos_id);
}
