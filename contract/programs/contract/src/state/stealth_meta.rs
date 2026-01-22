use anchor_lang::prelude::*;

/// Stealth Meta-Address Registry
///
/// Stores an employee's public stealth meta-address (S, V) on-chain.
/// Employers fetch this to derive one-time stealth addresses for payments.
///
/// The employee keeps (s, v) private keys secret and only publishes
/// the public keys (S = s*G, V = v*G).
///
/// Seeds: [b"stealth_meta", owner.key()]
#[account]
pub struct StealthMetaAddress {
    /// Owner who can update this meta-address
    pub owner: Pubkey,
    /// Spend public key (S = s * G) - used to derive stealth addresses
    pub spend_pubkey: [u8; 32],
    /// View public key (V = v * G) - used for ECDH shared secret
    pub view_pubkey: [u8; 32],
    /// Whether this meta-address is active
    pub is_active: bool,
    /// Timestamp when registered
    pub registered_at: i64,
    /// PDA bump seed
    pub bump: u8,
}

impl StealthMetaAddress {
    pub const SIZE: usize = 8 +  // discriminator
        32 +  // owner
        32 +  // spend_pubkey
        32 +  // view_pubkey
        1 +   // is_active
        8 +   // registered_at
        1;    // bump
    // Total: 114 bytes

    pub const SEED_PREFIX: &'static [u8] = b"stealth_meta";

    /// Check if meta-address is active
    pub fn is_active(&self) -> bool {
        self.is_active
    }

    /// Deactivate meta-address
    pub fn deactivate(&mut self) {
        self.is_active = false;
    }

    /// Update meta-address keys
    pub fn update_keys(&mut self, spend_pubkey: [u8; 32], view_pubkey: [u8; 32]) {
        self.spend_pubkey = spend_pubkey;
        self.view_pubkey = view_pubkey;
    }
}

/// Stealth Payment Event
///
/// Emitted when a payment is made to a stealth address.
/// Employees scan these events to discover payments.
#[event]
pub struct StealthPaymentEvent {
    /// Organization making the payment
    pub organization: Pubkey,
    /// The stealth address receiving payment
    pub stealth_address: Pubkey,
    /// Ephemeral public key (R = r * G) - needed for recipient to derive key
    pub ephemeral_pubkey: [u8; 32],
    /// Encrypted payload (contains ephemeral private key for recipient)
    pub encrypted_payload: [u8; 128],
    /// Position ID (if associated with a vesting position)
    pub position_id: u64,
    /// Token mint
    pub token_mint: Pubkey,
    /// Timestamp
    pub timestamp: i64,
}

/// Stealth Withdrawal Event
///
/// Emitted when funds are withdrawn from a stealth address.
#[event]
pub struct StealthWithdrawalEvent {
    /// The stealth address that was spent from
    pub stealth_address: Pubkey,
    /// Destination address (could be another stealth address or regular)
    pub destination: Pubkey,
    /// Amount withdrawn
    pub amount: u64,
    /// Token mint
    pub token_mint: Pubkey,
    /// Timestamp
    pub timestamp: i64,
}

/// Optional: Meta Keys Vault for MPC Storage
///
/// If using Arcium MPC to store meta-keys securely on-chain,
/// this account stores the encrypted keys.
///
/// Seeds: [b"meta_keys_vault", owner.key()]
#[account]
pub struct MetaKeysVault {
    /// Owner of this vault
    pub owner: Pubkey,
    /// Encrypted ciphertexts: [spend_lo, spend_hi, view_lo, view_hi]
    /// Each 32-byte key is split into two u128 values for MPC
    pub ciphertexts: [[u8; 32]; 4],
    /// Encryption nonce
    pub nonce: u128,
    /// Whether vault is initialized
    pub is_initialized: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl MetaKeysVault {
    pub const SIZE: usize = 8 +   // discriminator
        32 +   // owner
        128 +  // ciphertexts (4 * 32)
        16 +   // nonce (u128)
        1 +    // is_initialized
        1;     // bump
    // Total: 186 bytes

    pub const SEED_PREFIX: &'static [u8] = b"meta_keys_vault";
}
