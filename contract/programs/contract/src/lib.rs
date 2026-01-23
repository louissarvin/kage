use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

// Light Protocol imports for compressed positions (5000x cost reduction)
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{
        v1::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    derive_light_cpi_signer,
    instruction::{PackedAddressTreeInfo, ValidityProof},
    CpiSigner,
};

pub mod errors;
pub mod state;

use errors::ShadowVestError;
use state::{
    CompressedVestingPosition, MetaKeysVault, Organization, StealthMetaAddress, StealthPaymentEvent,
    VestingPosition, VestingSchedule,
};

// Computation definition offsets for Arcium circuits
const COMP_DEF_OFFSET_INIT_POSITION: u32 = comp_def_offset("init_position");
const COMP_DEF_OFFSET_CALCULATE_VESTED: u32 = comp_def_offset("calculate_vested");
const COMP_DEF_OFFSET_PROCESS_CLAIM: u32 = comp_def_offset("process_claim");
const COMP_DEF_OFFSET_STORE_META_KEYS: u32 = comp_def_offset("store_meta_keys");
const COMP_DEF_OFFSET_FETCH_META_KEYS: u32 = comp_def_offset("fetch_meta_keys");

declare_id!("3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA");

// Light Protocol CPI signer for compressed account operations
// This PDA is derived from "cpi_authority" seed and our program ID
pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA");

#[arcium_program]
pub mod contract {
    use super::*;

    // ============================================================
    // Computation Definition Initialization
    // ============================================================

    pub fn init_init_position_comp_def(ctx: Context<InitInitPositionCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://wajsatfcmlfkijmawyuq.supabase.co/storage/v1/object/public/init_position/init_position.arcis".to_string(),
                hash: circuit_hash!("init_position"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_calculate_vested_comp_def(ctx: Context<InitCalculateVestedCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://wajsatfcmlfkijmawyuq.supabase.co/storage/v1/object/public/init_position/calculate_vested.arcis".to_string(),
                hash: circuit_hash!("calculate_vested"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_process_claim_comp_def(ctx: Context<InitProcessClaimCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://wajsatfcmlfkijmawyuq.supabase.co/storage/v1/object/public/init_position/process_claim.arcis".to_string(),
                hash: circuit_hash!("process_claim"),
            })),
            None,
        )?;
        Ok(())
    }

    // ============================================================
    // Organization Management
    // ============================================================

    pub fn create_organization(
        ctx: Context<CreateOrganization>,
        name_hash: [u8; 32],
        treasury: Pubkey,
        token_mint: Pubkey,
    ) -> Result<()> {
        let organization = &mut ctx.accounts.organization;

        organization.admin = ctx.accounts.admin.key();
        organization.name_hash = name_hash;
        organization.schedule_count = 0;
        organization.position_count = 0;
        organization.compressed_position_count = 0;
        organization.treasury = treasury;
        organization.token_mint = token_mint;
        organization.is_active = true;
        organization.bump = ctx.bumps.organization;

        emit!(OrganizationCreated {
            organization: organization.key(),
            admin: organization.admin,
            name_hash,
            token_mint,
        });

        Ok(())
    }

    // ============================================================
    // Vesting Schedule Management
    // ============================================================

    pub fn create_vesting_schedule(
        ctx: Context<CreateVestingSchedule>,
        cliff_duration: u64,
        total_duration: u64,
        vesting_interval: u64,
    ) -> Result<()> {
        let organization = &mut ctx.accounts.organization;
        let schedule = &mut ctx.accounts.schedule;

        require!(
            total_duration > 0 && vesting_interval > 0,
            ShadowVestError::InvalidScheduleParams
        );
        require!(
            cliff_duration <= total_duration,
            ShadowVestError::InvalidScheduleParams
        );
        require!(
            organization.is_active,
            ShadowVestError::OrganizationNotActive
        );

        let schedule_id = organization.schedule_count;

        schedule.organization = organization.key();
        schedule.schedule_id = schedule_id;
        schedule.cliff_duration = cliff_duration;
        schedule.total_duration = total_duration;
        schedule.vesting_interval = vesting_interval;
        schedule.token_mint = organization.token_mint;
        schedule.is_active = true;
        schedule.position_count = 0;
        schedule.compressed_position_count = 0;
        schedule.bump = ctx.bumps.schedule;

        organization.schedule_count = organization
            .schedule_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        emit!(VestingScheduleCreated {
            organization: organization.key(),
            schedule: schedule.key(),
            schedule_id,
            cliff_duration,
            total_duration,
            vesting_interval,
        });

        Ok(())
    }

    // ============================================================
    // Vesting Position Management (with MPC)
    // ============================================================

    pub fn create_vesting_position(
        ctx: Context<CreateVestingPosition>,
        computation_offset: u64,
        beneficiary_commitment: [u8; 32],
        encrypted_total_amount: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // Validate state first
        require!(ctx.accounts.organization.is_active, ShadowVestError::OrganizationNotActive);
        require!(ctx.accounts.schedule.is_active, ShadowVestError::ScheduleNotActive);

        // Capture values needed for event before mutable borrows
        let position_id = ctx.accounts.organization.position_count;
        let clock = Clock::get()?;
        let org_key = ctx.accounts.organization.key();
        let schedule_key = ctx.accounts.schedule.key();

        // Initialize position
        {
            let position = &mut ctx.accounts.position;
            position.organization = org_key;
            position.schedule = schedule_key;
            position.position_id = position_id;
            position.beneficiary_commitment = beneficiary_commitment;
            position.encrypted_total_amount = encrypted_total_amount;
            position.encrypted_claimed_amount = [0u8; 32];
            position.nonce = nonce;
            position.start_timestamp = clock.unix_timestamp;
            position.is_active = true;
            position.is_fully_claimed = false;
            position.bump = ctx.bumps.position;
        }

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_total_amount)
            .build();

        let position_callback_account = CallbackAccount {
            pubkey: ctx.accounts.position.key(),
            is_writable: true,
        };

        let callback_ix = InitPositionCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[position_callback_account],
        )?;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![callback_ix],
            1,
            0,
        )?;

        // Update counters after queue_computation
        ctx.accounts.organization.position_count = ctx.accounts.organization
            .position_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        ctx.accounts.schedule.position_count = ctx.accounts.schedule
            .position_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        let position_key = ctx.accounts.position.key();
        let start_timestamp = ctx.accounts.position.start_timestamp;

        emit!(VestingPositionCreated {
            organization: org_key,
            schedule: schedule_key,
            position: position_key,
            position_id,
            beneficiary_commitment,
            start_timestamp,
        });

        Ok(())
    }

    /// Create a vesting position with stealth address beneficiary.
    ///
    /// The stealth address is derived off-chain by the employer:
    /// 1. Employer fetches employee's (S, V) from StealthMetaAddress
    /// 2. Generates ephemeral keypair (r, R = r*G)
    /// 3. Computes stealth_address = S + H(r * V) * G
    ///
    /// This instruction stores the position and emits StealthPaymentEvent
    /// so the employee can scan and discover the payment.
    pub fn create_stealth_vesting_position(
        ctx: Context<CreateVestingPosition>,
        computation_offset: u64,
        stealth_address: Pubkey,
        ephemeral_pubkey: [u8; 32],
        encrypted_payload: [u8; 128],
        encrypted_total_amount: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // Validate state first
        require!(ctx.accounts.organization.is_active, ShadowVestError::OrganizationNotActive);
        require!(ctx.accounts.schedule.is_active, ShadowVestError::ScheduleNotActive);

        // Use stealth address as beneficiary commitment
        let beneficiary_commitment = stealth_address.to_bytes();

        // Capture values needed for events before mutable borrows
        let position_id = ctx.accounts.organization.position_count;
        let clock = Clock::get()?;
        let org_key = ctx.accounts.organization.key();
        let schedule_key = ctx.accounts.schedule.key();
        let token_mint = ctx.accounts.organization.token_mint;

        // Initialize position
        {
            let position = &mut ctx.accounts.position;
            position.organization = org_key;
            position.schedule = schedule_key;
            position.position_id = position_id;
            position.beneficiary_commitment = beneficiary_commitment;
            position.encrypted_total_amount = encrypted_total_amount;
            position.encrypted_claimed_amount = [0u8; 32];
            position.nonce = nonce;
            position.start_timestamp = clock.unix_timestamp;
            position.is_active = true;
            position.is_fully_claimed = false;
            position.bump = ctx.bumps.position;
        }

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_total_amount)
            .build();

        let position_callback_account = CallbackAccount {
            pubkey: ctx.accounts.position.key(),
            is_writable: true,
        };

        let callback_ix = InitPositionCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[position_callback_account],
        )?;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![callback_ix],
            1,
            0,
        )?;

        // Update counters after queue_computation
        ctx.accounts.organization.position_count = ctx.accounts.organization
            .position_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        ctx.accounts.schedule.position_count = ctx.accounts.schedule
            .position_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        let position_key = ctx.accounts.position.key();
        let start_timestamp = ctx.accounts.position.start_timestamp;

        // Emit both events for indexing
        emit!(VestingPositionCreated {
            organization: org_key,
            schedule: schedule_key,
            position: position_key,
            position_id,
            beneficiary_commitment,
            start_timestamp,
        });

        // Emit stealth payment event for employee scanning
        emit!(StealthPaymentEvent {
            organization: org_key,
            stealth_address,
            ephemeral_pubkey,
            encrypted_payload,
            position_id,
            token_mint,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_position")]
    pub fn init_position_callback(
        ctx: Context<InitPositionCallback>,
        output: SignedComputationOutputs<InitPositionOutput>,
    ) -> Result<()> {
        let verified = output
            .verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)
            .map_err(|_| ErrorCode::AbortedComputation)?;

        let position = &mut ctx.accounts.position;
        position.encrypted_total_amount = verified.field_0.ciphertexts[0];
        position.encrypted_claimed_amount = verified.field_0.ciphertexts[1];

        emit!(VestingPositionInitialized {
            position: position.key(),
            position_id: position.position_id,
        });

        Ok(())
    }

    // ============================================================
    // Vesting Calculations (with MPC)
    // ============================================================

    pub fn calculate_vested_amount(
        ctx: Context<CalculateVestedAmount>,
        computation_offset: u64,
        encrypted_total_amount: [u8; 32],
        encrypted_claimed_amount: [u8; 32],
        encrypted_vesting_numerator: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let position = &ctx.accounts.position;

        require!(position.is_active, ShadowVestError::PositionNotActive);
        require!(!position.is_fully_claimed, ShadowVestError::PositionFullyClaimed);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // All values must be encrypted with the same key/nonce for MPC
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_total_amount)
            .encrypted_u64(encrypted_claimed_amount)
            .encrypted_u64(encrypted_vesting_numerator)
            .build();

        let position_callback_account = CallbackAccount {
            pubkey: ctx.accounts.position.key(),
            is_writable: false,
        };

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CalculateVestedCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[position_callback_account],
            )?],
            1,
            0,
        )?;

        emit!(VestedAmountCalculationQueued {
            position: position.key(),
            position_id: position.position_id,
            computation_offset,
        });

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "calculate_vested")]
    pub fn calculate_vested_callback(
        ctx: Context<CalculateVestedCallback>,
        output: SignedComputationOutputs<CalculateVestedOutput>,
    ) -> Result<()> {
        let verified = output
            .verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)
            .map_err(|_| ErrorCode::AbortedComputation)?;

        let position = &ctx.accounts.position;

        emit!(VestedAmountCalculated {
            position: position.key(),
            position_id: position.position_id,
            encrypted_vested_amount: verified.field_0.ciphertexts[0],
            encrypted_claimable_amount: verified.field_0.ciphertexts[1],
            nonce: verified.field_0.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // ============================================================
    // Compressed Vesting Positions (Light Protocol - 5000x cost reduction)
    // ============================================================

    /// Create a compressed vesting position using Light Protocol.
    /// This stores the position in a Merkle tree for 5000x cost reduction.
    ///
    /// The position data is hashed and stored in Light Protocol's state tree,
    /// while encrypted amounts are stored for Arcium MPC processing.
    ///
    /// # Arguments
    /// * `proof_bytes` - Serialized validity proof for Light Protocol state transition
    /// * `address_tree_info_bytes` - Serialized address tree info for derivation
    /// * `output_tree_index` - Index of the output state tree
    /// * `beneficiary_commitment` - Hash commitment of beneficiary identity
    /// * `encrypted_total_amount` - Arcium-encrypted total vesting amount
    /// * `nonce` - Nonce for Arcium encryption
    ///
    /// Note: This instruction requires Light Protocol accounts in remaining_accounts:
    /// - light_system_program
    /// - account_compression_program
    /// - registered_program_pda
    /// - noop_program
    /// - cpi_authority_pda
    /// - state_merkle_tree
    /// - address_merkle_tree
    /// - address_queue
    pub fn create_compressed_vesting_position<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateCompressedVestingPosition<'info>>,
        proof_bytes: Vec<u8>,
        address_tree_info_bytes: Vec<u8>,
        output_tree_index: u8,
        beneficiary_commitment: [u8; 32],
        encrypted_total_amount: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // Validate organization and schedule state
        require!(
            ctx.accounts.organization.is_active,
            ShadowVestError::OrganizationNotActive
        );
        require!(
            ctx.accounts.schedule.is_active,
            ShadowVestError::ScheduleNotActive
        );

        // Deserialize the Light Protocol types from bytes
        let proof: ValidityProof = borsh::BorshDeserialize::try_from_slice(&proof_bytes)
            .map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;
        let address_tree_info: PackedAddressTreeInfo =
            borsh::BorshDeserialize::try_from_slice(&address_tree_info_bytes)
                .map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;

        // Get current position ID and timestamp
        let position_id = ctx.accounts.organization.compressed_position_count;
        let clock = Clock::get()?;

        // Initialize CPI accounts for Light Protocol
        let cpi_accounts = CpiAccounts::new(
            ctx.accounts.fee_payer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Derive unique address for this compressed position
        // Seeds: [prefix, organization, position_id]
        let (address, address_seed) = derive_address(
            &[
                CompressedVestingPosition::SEED_PREFIX,
                ctx.accounts.organization.key().as_ref(),
                &position_id.to_le_bytes(),
            ],
            &address_tree_info
                .get_tree_pubkey(&cpi_accounts)
                .map_err(|_| ShadowVestError::InvalidAddressTree)?,
            &crate::ID,
        );

        // Create new address parameters for the Merkle tree
        let new_address_params = address_tree_info.into_new_address_params_packed(address_seed);

        // Initialize the compressed vesting position
        let mut compressed_position =
            LightAccount::<CompressedVestingPosition>::new_init(&crate::ID, Some(address), output_tree_index);

        // Set position data
        compressed_position.owner = ctx.accounts.admin.key();
        compressed_position.organization = ctx.accounts.organization.key();
        compressed_position.schedule = ctx.accounts.schedule.key();
        compressed_position.position_id = position_id;
        compressed_position.beneficiary_commitment = beneficiary_commitment;
        compressed_position.encrypted_total_amount = encrypted_total_amount;
        compressed_position.encrypted_claimed_amount = [0u8; 32];
        compressed_position.nonce = nonce;
        compressed_position.start_timestamp = clock.unix_timestamp;
        compressed_position.is_active = 1;
        compressed_position.is_fully_claimed = 0;

        // Execute Light Protocol CPI to create the compressed account
        LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_new_addresses(&[new_address_params])
            .with_light_account(compressed_position)?
            .invoke(cpi_accounts)?;

        // Update organization counter
        ctx.accounts.organization.compressed_position_count = ctx
            .accounts
            .organization
            .compressed_position_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        // Update schedule counter
        ctx.accounts.schedule.compressed_position_count = ctx
            .accounts
            .schedule
            .compressed_position_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        // Emit event for indexing
        emit!(CompressedPositionCreated {
            organization: ctx.accounts.organization.key(),
            schedule: ctx.accounts.schedule.key(),
            position_id,
            address,
            beneficiary_commitment,
            start_timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Create a compressed vesting position with stealth address beneficiary.
    ///
    /// Combines Light Protocol's 5000x cost reduction with stealth address privacy.
    /// The stealth address is derived off-chain by the employer using employee's (S, V).
    ///
    /// Emits both CompressedPositionCreated and StealthPaymentEvent for indexing/scanning.
    pub fn create_compressed_stealth_vesting_position<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateCompressedVestingPosition<'info>>,
        proof_bytes: Vec<u8>,
        address_tree_info_bytes: Vec<u8>,
        output_tree_index: u8,
        stealth_address: Pubkey,
        ephemeral_pubkey: [u8; 32],
        encrypted_payload: [u8; 128],
        encrypted_total_amount: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // Validate organization and schedule state
        require!(
            ctx.accounts.organization.is_active,
            ShadowVestError::OrganizationNotActive
        );
        require!(
            ctx.accounts.schedule.is_active,
            ShadowVestError::ScheduleNotActive
        );

        // Use stealth address as beneficiary commitment
        let beneficiary_commitment = stealth_address.to_bytes();

        // Deserialize the Light Protocol types from bytes
        let proof: ValidityProof = borsh::BorshDeserialize::try_from_slice(&proof_bytes)
            .map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;
        let address_tree_info: PackedAddressTreeInfo =
            borsh::BorshDeserialize::try_from_slice(&address_tree_info_bytes)
                .map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;

        // Get current position ID and timestamp
        let position_id = ctx.accounts.organization.compressed_position_count;
        let clock = Clock::get()?;
        let token_mint = ctx.accounts.organization.token_mint;
        let org_key = ctx.accounts.organization.key();
        let schedule_key = ctx.accounts.schedule.key();

        // Initialize CPI accounts for Light Protocol
        let cpi_accounts = CpiAccounts::new(
            ctx.accounts.fee_payer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Derive unique address for this compressed position
        // Seeds: [prefix, organization, position_id]
        let (address, address_seed) = derive_address(
            &[
                CompressedVestingPosition::SEED_PREFIX,
                ctx.accounts.organization.key().as_ref(),
                &position_id.to_le_bytes(),
            ],
            &address_tree_info
                .get_tree_pubkey(&cpi_accounts)
                .map_err(|_| ShadowVestError::InvalidAddressTree)?,
            &crate::ID,
        );

        // Create new address parameters for the Merkle tree
        let new_address_params = address_tree_info.into_new_address_params_packed(address_seed);

        // Initialize the compressed vesting position
        let mut compressed_position =
            LightAccount::<CompressedVestingPosition>::new_init(&crate::ID, Some(address), output_tree_index);

        // Set position data with stealth address as beneficiary
        compressed_position.owner = ctx.accounts.admin.key();
        compressed_position.organization = org_key;
        compressed_position.schedule = schedule_key;
        compressed_position.position_id = position_id;
        compressed_position.beneficiary_commitment = beneficiary_commitment;
        compressed_position.encrypted_total_amount = encrypted_total_amount;
        compressed_position.encrypted_claimed_amount = [0u8; 32];
        compressed_position.nonce = nonce;
        compressed_position.start_timestamp = clock.unix_timestamp;
        compressed_position.is_active = 1;
        compressed_position.is_fully_claimed = 0;

        // Execute Light Protocol CPI to create the compressed account
        LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_new_addresses(&[new_address_params])
            .with_light_account(compressed_position)?
            .invoke(cpi_accounts)?;

        // Update organization counter
        ctx.accounts.organization.compressed_position_count = ctx
            .accounts
            .organization
            .compressed_position_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        // Update schedule counter
        ctx.accounts.schedule.compressed_position_count = ctx
            .accounts
            .schedule
            .compressed_position_count
            .checked_add(1)
            .ok_or(ShadowVestError::ArithmeticOverflow)?;

        // Emit event for indexing
        emit!(CompressedPositionCreated {
            organization: org_key,
            schedule: schedule_key,
            position_id,
            address,
            beneficiary_commitment,
            start_timestamp: clock.unix_timestamp,
        });

        // Emit stealth payment event for employee scanning
        emit!(StealthPaymentEvent {
            organization: org_key,
            stealth_address,
            ephemeral_pubkey,
            encrypted_payload,
            position_id,
            token_mint,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    // ============================================================
    // Stealth Address Management
    // ============================================================

    /// Register stealth meta-address (S, V) for an employee.
    /// Employees call this to publish their public stealth keys.
    /// Employers fetch these to derive one-time stealth addresses for payments.
    pub fn register_stealth_meta(
        ctx: Context<RegisterStealthMeta>,
        spend_pubkey: [u8; 32],
        view_pubkey: [u8; 32],
    ) -> Result<()> {
        let meta = &mut ctx.accounts.stealth_meta;
        let clock = Clock::get()?;

        meta.owner = ctx.accounts.owner.key();
        meta.spend_pubkey = spend_pubkey;
        meta.view_pubkey = view_pubkey;
        meta.is_active = true;
        meta.registered_at = clock.unix_timestamp;
        meta.bump = ctx.bumps.stealth_meta;

        emit!(StealthMetaRegistered {
            owner: meta.owner,
            spend_pubkey,
            view_pubkey,
            registered_at: meta.registered_at,
        });

        Ok(())
    }

    /// Update stealth meta-address keys.
    /// Allows employee to rotate their stealth keys.
    pub fn update_stealth_meta(
        ctx: Context<UpdateStealthMeta>,
        spend_pubkey: [u8; 32],
        view_pubkey: [u8; 32],
    ) -> Result<()> {
        let meta = &mut ctx.accounts.stealth_meta;

        require!(meta.is_active, ShadowVestError::StealthMetaNotActive);

        meta.spend_pubkey = spend_pubkey;
        meta.view_pubkey = view_pubkey;

        emit!(StealthMetaUpdated {
            owner: meta.owner,
            spend_pubkey,
            view_pubkey,
        });

        Ok(())
    }

    /// Deactivate stealth meta-address.
    /// Employee can deactivate to stop receiving stealth payments.
    pub fn deactivate_stealth_meta(ctx: Context<DeactivateStealthMeta>) -> Result<()> {
        let meta = &mut ctx.accounts.stealth_meta;

        require!(meta.is_active, ShadowVestError::StealthMetaNotActive);

        meta.is_active = false;

        emit!(StealthMetaDeactivated { owner: meta.owner });

        Ok(())
    }

    // ============================================================
    // MPC Meta-Keys Vault (Optional Secure Storage)
    // ============================================================

    /// Initialize MPC computation definition for store_meta_keys
    pub fn init_store_meta_keys_comp_def(ctx: Context<InitStoreMetaKeysCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://wajsatfcmlfkijmawyuq.supabase.co/storage/v1/object/public/init_position/store_meta_keys.arcis".to_string(),
                hash: circuit_hash!("store_meta_keys"),
            })),
            None,
        )?;
        Ok(())
    }

    /// Initialize MPC computation definition for fetch_meta_keys
    pub fn init_fetch_meta_keys_comp_def(ctx: Context<InitFetchMetaKeysCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://wajsatfcmlfkijmawyuq.supabase.co/storage/v1/object/public/init_position/fetch_meta_keys.arcis".to_string(),
                hash: circuit_hash!("fetch_meta_keys"),
            })),
            None,
        )?;
        Ok(())
    }

    /// Store meta-keys in MPC vault.
    /// Employee's private keys are encrypted via Arcium MPC.
    /// Only the MPC cluster can decrypt; re-encrypts specifically for user on read.
    pub fn write_meta_keys_to_vault(
        ctx: Context<WriteMetaKeysToVault>,
        computation_offset: u64,
        encrypted_spend_lo: [u8; 32],
        encrypted_spend_hi: [u8; 32],
        encrypted_view_lo: [u8; 32],
        encrypted_view_hi: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        mxe_nonce: u128,
    ) -> Result<()> {
        // Capture keys first before mutable borrow
        let owner_key = ctx.accounts.owner.key();
        let vault_key = ctx.accounts.meta_keys_vault.key();

        // Initialize vault
        {
            let vault = &mut ctx.accounts.meta_keys_vault;
            vault.owner = owner_key;
            vault.ciphertexts = [
                encrypted_spend_lo,
                encrypted_spend_hi,
                encrypted_view_lo,
                encrypted_view_hi,
            ];
            vault.nonce = nonce;
            vault.is_initialized = false; // Will be set true in callback
            vault.bump = ctx.bumps.meta_keys_vault;
        }

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Queue MPC computation to re-encrypt with MXE key
        // Circuit: write_meta_keys(user_input: Enc<Shared, MetaKeys>, mxe: Mxe) -> Enc<Mxe, MetaKeys>
        let args = ArgBuilder::new()
            // Enc<Shared, MetaKeys> - user's encrypted keys
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u128(encrypted_spend_lo)
            .encrypted_u128(encrypted_spend_hi)
            .encrypted_u128(encrypted_view_lo)
            .encrypted_u128(encrypted_view_hi)
            // Mxe parameter - nonce for MXE re-encryption
            .plaintext_u128(mxe_nonce)
            .build();

        let vault_callback_account = CallbackAccount {
            pubkey: vault_key,
            is_writable: true,
        };

        let callback_ix = StoreMetaKeysCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[vault_callback_account],
        )?;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![callback_ix],
            1,
            0,
        )?;

        emit!(MetaKeysVaultCreated {
            owner: owner_key,
            vault: vault_key,
        });

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "store_meta_keys")]
    pub fn store_meta_keys_callback(
        ctx: Context<StoreMetaKeysCallback>,
        output: SignedComputationOutputs<StoreMetaKeysOutput>,
    ) -> Result<()> {
        let verified = output
            .verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)
            .map_err(|_| ErrorCode::AbortedComputation)?;

        let vault = &mut ctx.accounts.meta_keys_vault;

        // Store MXE-encrypted ciphertexts and nonce
        vault.ciphertexts[0] = verified.field_0.ciphertexts[0];
        vault.ciphertexts[1] = verified.field_0.ciphertexts[1];
        vault.ciphertexts[2] = verified.field_0.ciphertexts[2];
        vault.ciphertexts[3] = verified.field_0.ciphertexts[3];
        vault.nonce = verified.field_0.nonce;
        vault.is_initialized = true;

        emit!(MetaKeysVaultInitialized {
            owner: vault.owner,
            vault: vault.key(),
        });

        Ok(())
    }

    /// Read meta-keys from MPC vault.
    /// MPC re-encrypts stored keys specifically for the requesting user.
    pub fn read_meta_keys_from_vault(
        ctx: Context<ReadMetaKeysFromVault>,
        computation_offset: u64,
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let vault = &ctx.accounts.meta_keys_vault;

        require!(
            vault.is_initialized,
            ShadowVestError::MetaKeysVaultNotInitialized
        );

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Queue MPC computation to re-encrypt for user
        // Circuit: read_meta_keys(requester: Shared, stored_keys: Enc<Mxe, MetaKeys>) -> Enc<Shared, MetaKeys>
        let vault_key = vault.key();
        let args = ArgBuilder::new()
            // Shared - requester's x25519 pubkey and nonce
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            // Enc<Mxe, MetaKeys> - nonce + account data
            // Account layout: 8 (discriminator) + 32 (owner) + 128 (ciphertexts)
            .plaintext_u128(vault.nonce)
            .account(vault_key, 40, 128) // Skip discriminator + owner, read 4 x 32 bytes ciphertexts
            .build();

        let vault_callback_account = CallbackAccount {
            pubkey: vault.key(),
            is_writable: false,
        };

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![FetchMetaKeysCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[vault_callback_account],
            )?],
            1,
            0,
        )?;

        emit!(MetaKeysReadRequested {
            owner: vault.owner,
            vault: vault.key(),
            computation_offset,
        });

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "fetch_meta_keys")]
    pub fn fetch_meta_keys_callback(
        ctx: Context<FetchMetaKeysCallback>,
        output: SignedComputationOutputs<FetchMetaKeysOutput>,
    ) -> Result<()> {
        let verified = output
            .verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)
            .map_err(|_| ErrorCode::AbortedComputation)?;

        let vault = &ctx.accounts.meta_keys_vault;

        // Emit event with re-encrypted keys for the user to decrypt
        emit!(MetaKeysRetrieved {
            owner: vault.owner,
            vault: vault.key(),
            encrypted_spend_lo: verified.field_0.ciphertexts[0],
            encrypted_spend_hi: verified.field_0.ciphertexts[1],
            encrypted_view_lo: verified.field_0.ciphertexts[2],
            encrypted_view_hi: verified.field_0.ciphertexts[3],
            nonce: verified.field_0.nonce.to_le_bytes(),
        });

        Ok(())
    }
}

// ============================================================
// Account Contexts - Position Creation
// ============================================================

#[queue_computation_accounts("init_position", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, beneficiary_commitment: [u8; 32])]
pub struct CreateVestingPosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [Organization::SEED_PREFIX, admin.key().as_ref()],
        bump = organization.bump,
        has_one = admin @ ShadowVestError::UnauthorizedAdmin,
    )]
    pub organization: Account<'info, Organization>,
    #[account(
        mut,
        seeds = [VestingSchedule::SEED_PREFIX, organization.key().as_ref(), schedule.schedule_id.to_le_bytes().as_ref()],
        bump = schedule.bump,
        constraint = schedule.organization == organization.key() @ ShadowVestError::InvalidScheduleParams,
    )]
    pub schedule: Account<'info, VestingSchedule>,
    #[account(
        init,
        payer = payer,
        space = VestingPosition::SIZE,
        seeds = [VestingPosition::SEED_PREFIX, organization.key().as_ref(), organization.position_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub position: Account<'info, VestingPosition>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [b"ArciumSignerAccount"],
        bump,
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_POSITION))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_position")]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct InitPositionCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_POSITION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position: Account<'info, VestingPosition>,
}

// ============================================================
// Account Contexts - Vesting Calculation
// ============================================================

#[queue_computation_accounts("calculate_vested", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CalculateVestedAmount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [Organization::SEED_PREFIX, organization.admin.as_ref()], bump = organization.bump)]
    pub organization: Account<'info, Organization>,
    #[account(
        seeds = [VestingSchedule::SEED_PREFIX, organization.key().as_ref(), schedule.schedule_id.to_le_bytes().as_ref()],
        bump = schedule.bump,
        constraint = schedule.organization == organization.key() @ ShadowVestError::InvalidScheduleParams,
    )]
    pub schedule: Account<'info, VestingSchedule>,
    #[account(
        seeds = [VestingPosition::SEED_PREFIX, organization.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        constraint = position.organization == organization.key() @ ShadowVestError::InvalidScheduleParams,
        constraint = position.schedule == schedule.key() @ ShadowVestError::InvalidScheduleParams,
    )]
    pub position: Account<'info, VestingPosition>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [b"ArciumSignerAccount"],
        bump,
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_VESTED))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("calculate_vested")]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CalculateVestedCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_VESTED))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    pub position: Account<'info, VestingPosition>,
}

// ============================================================
// Computation Definition Init Accounts
// ============================================================

#[init_computation_definition_accounts("init_position", payer)]
#[derive(Accounts)]
pub struct InitInitPositionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("calculate_vested", payer)]
#[derive(Accounts)]
pub struct InitCalculateVestedCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("process_claim", payer)]
#[derive(Accounts)]
pub struct InitProcessClaimCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ============================================================
// Account Contexts - Organization & Schedule (Non-MPC)
// ============================================================

#[derive(Accounts)]
pub struct CreateOrganization<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Organization::SIZE,
        seeds = [Organization::SEED_PREFIX, admin.key().as_ref()],
        bump,
    )]
    pub organization: Account<'info, Organization>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateVestingSchedule<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [Organization::SEED_PREFIX, admin.key().as_ref()],
        bump = organization.bump,
        has_one = admin @ ShadowVestError::UnauthorizedAdmin,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        init,
        payer = admin,
        space = VestingSchedule::SIZE,
        seeds = [
            VestingSchedule::SEED_PREFIX,
            organization.key().as_ref(),
            organization.schedule_count.to_le_bytes().as_ref()
        ],
        bump,
    )]
    pub schedule: Account<'info, VestingSchedule>,

    pub system_program: Program<'info, System>,
}

// ============================================================
// Account Contexts - Compressed Vesting Positions (Light Protocol)
// ============================================================

/// Account context for creating compressed vesting positions.
/// Uses Light Protocol CPI for 5000x cost reduction.
///
/// Note: Light Protocol accounts are passed via `remaining_accounts`:
/// - light_system_program
/// - account_compression_program
/// - registered_program_pda
/// - noop_program
/// - cpi_authority_pda
/// - state_merkle_tree
/// - address_merkle_tree
/// - address_queue
#[derive(Accounts)]
pub struct CreateCompressedVestingPosition<'info> {
    /// Fee payer for the Light Protocol CPI transaction
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    /// Organization admin who can create positions
    pub admin: Signer<'info>,

    /// Organization account (mutable for counter update)
    #[account(
        mut,
        seeds = [Organization::SEED_PREFIX, admin.key().as_ref()],
        bump = organization.bump,
        has_one = admin @ ShadowVestError::UnauthorizedAdmin,
    )]
    pub organization: Account<'info, Organization>,

    /// Vesting schedule for this position
    #[account(
        mut,
        seeds = [
            VestingSchedule::SEED_PREFIX,
            organization.key().as_ref(),
            schedule.schedule_id.to_le_bytes().as_ref()
        ],
        bump = schedule.bump,
        constraint = schedule.organization == organization.key() @ ShadowVestError::InvalidScheduleParams,
    )]
    pub schedule: Account<'info, VestingSchedule>,

    /// System program for account creation
    pub system_program: Program<'info, System>,
    // Remaining accounts are provided dynamically for Light Protocol CPI
}

// ============================================================
// Account Contexts - Stealth Meta-Address
// ============================================================

#[derive(Accounts)]
pub struct RegisterStealthMeta<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = StealthMetaAddress::SIZE,
        seeds = [StealthMetaAddress::SEED_PREFIX, owner.key().as_ref()],
        bump,
    )]
    pub stealth_meta: Account<'info, StealthMetaAddress>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateStealthMeta<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [StealthMetaAddress::SEED_PREFIX, owner.key().as_ref()],
        bump = stealth_meta.bump,
        has_one = owner @ ShadowVestError::UnauthorizedOwner,
    )]
    pub stealth_meta: Account<'info, StealthMetaAddress>,
}

#[derive(Accounts)]
pub struct DeactivateStealthMeta<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [StealthMetaAddress::SEED_PREFIX, owner.key().as_ref()],
        bump = stealth_meta.bump,
        has_one = owner @ ShadowVestError::UnauthorizedOwner,
    )]
    pub stealth_meta: Account<'info, StealthMetaAddress>,
}

// ============================================================
// Account Contexts - MPC Meta-Keys Vault
// ============================================================

#[init_computation_definition_accounts("store_meta_keys", payer)]
#[derive(Accounts)]
pub struct InitStoreMetaKeysCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("fetch_meta_keys", payer)]
#[derive(Accounts)]
pub struct InitFetchMetaKeysCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("store_meta_keys", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct WriteMetaKeysToVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = MetaKeysVault::SIZE,
        seeds = [MetaKeysVault::SEED_PREFIX, owner.key().as_ref()],
        bump,
    )]
    pub meta_keys_vault: Account<'info, MetaKeysVault>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [b"ArciumSignerAccount"],
        bump,
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_STORE_META_KEYS))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("store_meta_keys")]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct StoreMetaKeysCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_STORE_META_KEYS))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub meta_keys_vault: Account<'info, MetaKeysVault>,
}

#[queue_computation_accounts("fetch_meta_keys", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ReadMetaKeysFromVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    #[account(
        seeds = [MetaKeysVault::SEED_PREFIX, owner.key().as_ref()],
        bump = meta_keys_vault.bump,
        has_one = owner @ ShadowVestError::UnauthorizedOwner,
    )]
    pub meta_keys_vault: Account<'info, MetaKeysVault>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [b"ArciumSignerAccount"],
        bump,
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FETCH_META_KEYS))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("fetch_meta_keys")]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct FetchMetaKeysCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FETCH_META_KEYS))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    pub meta_keys_vault: Account<'info, MetaKeysVault>,
}

// ============================================================
// Events
// ============================================================

#[event]
pub struct OrganizationCreated {
    pub organization: Pubkey,
    pub admin: Pubkey,
    pub name_hash: [u8; 32],
    pub token_mint: Pubkey,
}

#[event]
pub struct VestingScheduleCreated {
    pub organization: Pubkey,
    pub schedule: Pubkey,
    pub schedule_id: u64,
    pub cliff_duration: u64,
    pub total_duration: u64,
    pub vesting_interval: u64,
}

#[event]
pub struct VestingPositionCreated {
    pub organization: Pubkey,
    pub schedule: Pubkey,
    pub position: Pubkey,
    pub position_id: u64,
    pub beneficiary_commitment: [u8; 32],
    pub start_timestamp: i64,
}

#[event]
pub struct VestingPositionInitialized {
    pub position: Pubkey,
    pub position_id: u64,
}

#[event]
pub struct VestedAmountCalculationQueued {
    pub position: Pubkey,
    pub position_id: u64,
    pub computation_offset: u64,
}

#[event]
pub struct VestedAmountCalculated {
    pub position: Pubkey,
    pub position_id: u64,
    pub encrypted_vested_amount: [u8; 32],
    pub encrypted_claimable_amount: [u8; 32],
    pub nonce: [u8; 16],
}

// Phase 2b: Events for compressed positions

#[event]
pub struct CompressedPositionCreated {
    pub organization: Pubkey,
    pub schedule: Pubkey,
    pub position_id: u64,
    /// Light Protocol derived address for this compressed account
    pub address: [u8; 32],
    pub beneficiary_commitment: [u8; 32],
    pub start_timestamp: i64,
}

#[event]
pub struct CompressedPositionUpdated {
    pub organization: Pubkey,
    pub position_id: u64,
    pub address: [u8; 32],
    pub new_encrypted_claimed_amount: [u8; 32],
}

// Phase 4: Events for stealth addresses

#[event]
pub struct StealthMetaRegistered {
    pub owner: Pubkey,
    pub spend_pubkey: [u8; 32],
    pub view_pubkey: [u8; 32],
    pub registered_at: i64,
}

#[event]
pub struct StealthMetaUpdated {
    pub owner: Pubkey,
    pub spend_pubkey: [u8; 32],
    pub view_pubkey: [u8; 32],
}

#[event]
pub struct StealthMetaDeactivated {
    pub owner: Pubkey,
}

#[event]
pub struct MetaKeysVaultCreated {
    pub owner: Pubkey,
    pub vault: Pubkey,
}

#[event]
pub struct MetaKeysVaultInitialized {
    pub owner: Pubkey,
    pub vault: Pubkey,
}

#[event]
pub struct MetaKeysReadRequested {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub computation_offset: u64,
}

#[event]
pub struct MetaKeysRetrieved {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub encrypted_spend_lo: [u8; 32],
    pub encrypted_spend_hi: [u8; 32],
    pub encrypted_view_lo: [u8; 32],
    pub encrypted_view_hi: [u8; 32],
    pub nonce: [u8; 16],
}

// ============================================================
// Error Codes
// ============================================================

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
