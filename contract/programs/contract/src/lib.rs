use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

/// Ed25519 signature verification program ID
const ED25519_PROGRAM_ID: Pubkey = Pubkey::from_str_const("Ed25519SigVerify111111111111111111111111111");
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
    instruction::{
        account_meta::CompressedAccountMeta,
        PackedAddressTreeInfo, ValidityProof,
    },
    CpiSigner,
};

pub mod errors;
pub mod groth16_verifier;
pub mod state;

use errors::ShadowVestError;
use groth16_verifier::{
    EligibilityPublicInputs, Groth16Proof, IdentityPublicInputs, VerificationKey,
    WithdrawalPublicInputs,
};
use state::{
    ClaimAuthorization, CompressedVestingPosition, MetaKeysVault, NullifierRecord,
    Organization, ProofRecord, StealthMetaAddress, StealthPaymentEvent,
    VerificationKeyAccount, VestingPosition, VestingSchedule,
};

// Computation definition offsets for Arcium circuits
const COMP_DEF_OFFSET_INIT_POSITION: u32 = comp_def_offset("init_position");
const COMP_DEF_OFFSET_CALCULATE_VESTED: u32 = comp_def_offset("calculate_vested");
const COMP_DEF_OFFSET_PROCESS_CLAIM: u32 = comp_def_offset("process_claim");
const COMP_DEF_OFFSET_PROCESS_CLAIM_V2: u32 = comp_def_offset("process_claim_v2");
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

    pub fn init_process_claim_v2_comp_def(ctx: Context<InitProcessClaimV2CompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://wajsatfcmlfkijmawyuq.supabase.co/storage/v1/object/public/init_position/process_claim_v2.arcis".to_string(),
                hash: circuit_hash!("process_claim_v2"),
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
    // Claim Authorization & Withdrawal
    // ============================================================

    /// Authorize a claim using Ed25519 stealth signature verification.
    ///
    /// The caller must prepend an Ed25519Program instruction that verifies
    /// a signature from the stealth address (beneficiary_commitment) over
    /// the message: hash(position_id, nullifier, withdrawal_destination).
    ///
    /// This creates a ClaimAuthorization PDA and a NullifierRecord PDA.
    /// The NullifierRecord uses init constraint for double-claim prevention.
    pub fn authorize_claim(
        ctx: Context<AuthorizeClaim>,
        nullifier: [u8; 32],
        withdrawal_destination: Pubkey,
    ) -> Result<()> {
        let position = &ctx.accounts.position;

        require!(position.is_active, ShadowVestError::PositionNotActive);
        require!(!position.is_fully_claimed, ShadowVestError::PositionFullyClaimed);

        // Verify the Ed25519 signature from the preceding instruction
        // The instructions sysvar lets us read the previous instruction
        let ix_sysvar = &ctx.accounts.instructions_sysvar;
        let current_ix_index = sysvar_instructions::load_current_index_checked(ix_sysvar)
            .map_err(|_| ShadowVestError::InvalidEligibilitySignature)?;

        // The Ed25519 instruction must be the one immediately before this instruction
        require!(
            current_ix_index > 0,
            ShadowVestError::InvalidEligibilitySignature
        );

        let ed25519_ix = sysvar_instructions::load_instruction_at_checked(
            (current_ix_index - 1) as usize,
            ix_sysvar,
        )
        .map_err(|_| ShadowVestError::InvalidEligibilitySignature)?;

        // Verify it's an Ed25519 program instruction
        require!(
            ed25519_ix.program_id == ED25519_PROGRAM_ID,
            ShadowVestError::InvalidEligibilitySignature
        );

        // Parse Ed25519 instruction data to verify pubkey matches beneficiary_commitment
        // Ed25519 instruction format: num_signatures (u8) + padding (u8) + signature_offsets...
        // Each signature offset struct: signature_offset(u16), signature_ix(u16),
        //   pubkey_offset(u16), pubkey_ix(u16), message_offset(u16), message_size(u16), message_ix(u16)
        require!(
            ed25519_ix.data.len() >= 16,
            ShadowVestError::InvalidEligibilitySignature
        );

        let num_signatures = ed25519_ix.data[0];
        require!(
            num_signatures == 1,
            ShadowVestError::InvalidEligibilitySignature
        );

        // Extract pubkey offset (bytes 6-7, little-endian)
        let pubkey_offset = u16::from_le_bytes([ed25519_ix.data[6], ed25519_ix.data[7]]) as usize;

        // Extract the signing pubkey (32 bytes at pubkey_offset)
        require!(
            ed25519_ix.data.len() >= pubkey_offset + 32,
            ShadowVestError::InvalidEligibilitySignature
        );
        let signer_pubkey = &ed25519_ix.data[pubkey_offset..pubkey_offset + 32];

        // Verify the signer matches the position's beneficiary_commitment (stealth address)
        require!(
            signer_pubkey == position.beneficiary_commitment,
            ShadowVestError::SignerMismatch
        );

        // Verify message is hash(position_id, nullifier, withdrawal_destination)
        let message_data_offset = u16::from_le_bytes([ed25519_ix.data[10], ed25519_ix.data[11]]) as usize;
        let message_data_size = u16::from_le_bytes([ed25519_ix.data[12], ed25519_ix.data[13]]) as usize;

        require!(
            ed25519_ix.data.len() >= message_data_offset + message_data_size,
            ShadowVestError::InvalidEligibilitySignature
        );

        let signed_message = &ed25519_ix.data[message_data_offset..message_data_offset + message_data_size];

        // Construct expected message: position_id || nullifier || withdrawal_destination (72 bytes)
        let mut expected_msg = [0u8; 72];
        expected_msg[..8].copy_from_slice(&position.position_id.to_le_bytes());
        expected_msg[8..40].copy_from_slice(&nullifier);
        expected_msg[40..72].copy_from_slice(withdrawal_destination.as_ref());

        require!(
            signed_message == expected_msg,
            ShadowVestError::InvalidEligibilitySignature
        );

        // Initialize ClaimAuthorization
        let clock = Clock::get()?;
        let claim_auth = &mut ctx.accounts.claim_authorization;
        claim_auth.position = position.key();
        claim_auth.nullifier = nullifier;
        claim_auth.withdrawal_destination = withdrawal_destination;
        claim_auth.claim_amount = 0;
        claim_auth.is_authorized = true;
        claim_auth.is_processed = false;
        claim_auth.is_withdrawn = false;
        claim_auth.authorized_at = clock.unix_timestamp;
        claim_auth.bump = ctx.bumps.claim_authorization;

        // Initialize NullifierRecord (init constraint prevents double-use)
        let nullifier_record = &mut ctx.accounts.nullifier_record;
        nullifier_record.nullifier = nullifier;
        nullifier_record.position = position.key();
        nullifier_record.used_at = clock.unix_timestamp;
        nullifier_record.bump = ctx.bumps.nullifier_record;

        emit!(ClaimAuthorized {
            position: position.key(),
            nullifier,
            withdrawal_destination,
        });

        Ok(())
    }

    /// Queue the process_claim_v2 MPC computation with integrated vesting calculation.
    ///
    /// Computes vesting_numerator on-chain from Clock + schedule parameters.
    /// Submits encrypted (total_amount, claimed_amount, vesting_numerator, claim_amount) to MPC.
    /// The MPC circuit internally computes: claimable = (total * numerator / PRECISION) - claimed
    /// Then validates: claim_amount <= claimable.
    /// Callback updates position.encrypted_claimed_amount and sets is_processed=true.
    pub fn queue_process_claim(
        ctx: Context<QueueProcessClaim>,
        computation_offset: u64,
        encrypted_total_amount: [u8; 32],
        encrypted_claimed_amount: [u8; 32],
        encrypted_vesting_numerator: [u8; 32],
        encrypted_claim_amount: [u8; 32],
        claim_amount: u64,
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let claim_auth = &ctx.accounts.claim_authorization;

        require!(claim_auth.is_authorized, ShadowVestError::ClaimNotAuthorized);
        require!(!claim_auth.is_processed, ShadowVestError::ClaimNotProcessed);

        let position = &ctx.accounts.position;
        let schedule = &ctx.accounts.schedule;
        require!(position.is_active, ShadowVestError::PositionNotActive);

        // Compute vesting_numerator on-chain from verifiable data
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let start_time = position.start_timestamp;
        let cliff_end = start_time + schedule.cliff_duration as i64;
        let vesting_end = start_time + schedule.total_duration as i64;

        const PRECISION: u64 = 1_000_000;

        let vesting_numerator = if current_time < cliff_end {
            0u64
        } else if current_time >= vesting_end {
            PRECISION
        } else {
            let elapsed = (current_time - cliff_end) as u64;
            let intervals = elapsed / schedule.vesting_interval;
            let vested_seconds = intervals * schedule.vesting_interval;
            let vesting_duration = schedule.total_duration - schedule.cliff_duration;
            if vesting_duration > 0 {
                vested_seconds * PRECISION / vesting_duration
            } else {
                PRECISION
            }
        };

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Args order matches ProcessClaimV2Input: total_amount, claimed_amount, vesting_numerator, claim_amount
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_total_amount)
            .encrypted_u64(encrypted_claimed_amount)
            .encrypted_u64(encrypted_vesting_numerator)
            .encrypted_u64(encrypted_claim_amount)
            .build();

        let position_callback_account = CallbackAccount {
            pubkey: ctx.accounts.position.key(),
            is_writable: true,
        };
        let claim_auth_callback_account = CallbackAccount {
            pubkey: ctx.accounts.claim_authorization.key(),
            is_writable: true,
        };

        let callback_ix = ProcessClaimV2Callback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[position_callback_account, claim_auth_callback_account],
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

        // Store claim_amount in the authorization for the callback to verify
        let claim_auth_mut = &mut ctx.accounts.claim_authorization;
        claim_auth_mut.claim_amount = claim_amount;

        emit!(ClaimProcessQueued {
            position: position.key(),
            position_id: position.position_id,
            claim_amount,
            computation_offset,
            vesting_numerator,
        });

        Ok(())
    }

    /// Callback from the process_claim_v2 MPC computation.
    ///
    /// Verifies the MPC output and updates:
    /// - position.encrypted_claimed_amount from output ciphertexts[0]
    /// - claim_authorization.is_processed = true
    #[arcium_callback(encrypted_ix = "process_claim_v2")]
    pub fn process_claim_v2_callback(
        ctx: Context<ProcessClaimV2Callback>,
        output: SignedComputationOutputs<ProcessClaimV2Output>,
    ) -> Result<()> {
        let verified = output
            .verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)
            .map_err(|_| ErrorCode::AbortedComputation)?;

        // Update position's encrypted claimed amount from MPC output
        let position = &mut ctx.accounts.position;
        position.encrypted_claimed_amount = verified.field_0.ciphertexts[0];

        // Mark authorization as processed
        let claim_auth = &mut ctx.accounts.claim_authorization;
        claim_auth.is_processed = true;

        emit!(ClaimProcessed {
            position: position.key(),
            position_id: position.position_id,
            claim_amount: claim_auth.claim_amount,
        });

        Ok(())
    }

    /// Initialize the token vault for an organization.
    ///
    /// Creates a token account owned by a vault_authority PDA.
    /// The organization admin can then deposit tokens to this vault.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let organization = &ctx.accounts.organization;
        require!(organization.is_active, ShadowVestError::OrganizationNotActive);

        emit!(VaultInitialized {
            organization: organization.key(),
            vault: ctx.accounts.vault.key(),
            vault_authority: ctx.accounts.vault_authority.key(),
            token_mint: organization.token_mint,
        });

        Ok(())
    }

    /// Deposit tokens into the organization vault.
    /// The depositor transfers SPL tokens from their token account to the vault.
    pub fn deposit_to_vault(ctx: Context<DepositToVault>, amount: u64) -> Result<()> {
        require!(ctx.accounts.organization.is_active, ShadowVestError::OrganizationNotActive);
        require!(amount > 0, ShadowVestError::InvalidClaimAmount);

        // Transfer tokens from admin's token account to vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.admin_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        emit!(VaultDeposited {
            organization: ctx.accounts.organization.key(),
            vault: ctx.accounts.vault.key(),
            depositor: ctx.accounts.admin.key(),
            amount,
        });

        Ok(())
    }

    /// Withdraw tokens from the organization vault to the beneficiary's destination.
    ///
    /// Verifies the claim has been authorized, processed by MPC, and not yet withdrawn.
    /// Transfers claim_amount tokens from vault to destination.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let claim_auth = &ctx.accounts.claim_authorization;

        require!(claim_auth.is_authorized, ShadowVestError::ClaimNotAuthorized);
        require!(claim_auth.is_processed, ShadowVestError::ClaimNotProcessed);
        require!(!claim_auth.is_withdrawn, ShadowVestError::AlreadyWithdrawn);

        // Verify destination matches what was authorized
        require!(
            ctx.accounts.destination.key() == claim_auth.withdrawal_destination,
            ShadowVestError::InvalidWithdrawalDestination
        );

        let amount = claim_auth.claim_amount;

        // Verify vault has sufficient balance
        require!(
            ctx.accounts.vault.amount >= amount,
            ShadowVestError::InsufficientVaultBalance
        );

        // Transfer tokens from vault to destination
        let org_key = ctx.accounts.organization.key();
        let bump = ctx.bumps.vault_authority;
        let vault_authority_seeds: &[&[u8]] = &[
            b"vault_authority",
            org_key.as_ref(),
            std::slice::from_ref(&bump),
        ];
        let signer_seeds = &[vault_authority_seeds];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, amount)?;

        // Mark as withdrawn
        let claim_auth_mut = &mut ctx.accounts.claim_authorization;
        claim_auth_mut.is_withdrawn = true;

        let token_mint = ctx.accounts.vault.mint;

        emit!(ClaimWithdrawn {
            position: claim_auth_mut.position,
            destination: claim_auth_mut.withdrawal_destination,
            amount,
            token_mint,
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
    // Compressed Position Claim & Withdraw Flow
    // ============================================================

    /// Authorize a claim from a compressed vesting position.
    ///
    /// Similar to authorize_claim but works with Light Protocol compressed accounts.
    /// The compressed position data is read via Light Protocol CPI (validity proof verification).
    /// An Ed25519 signature from the stealth keypair authorizes the claim.
    ///
    /// This creates a ClaimAuthorization PDA that the withdraw_compressed() can reference.
    pub fn authorize_claim_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, AuthorizeClaimCompressed<'info>>,
        proof_bytes: Vec<u8>,
        account_meta_bytes: Vec<u8>,
        // Compressed position data (client fetches from Light RPC):
        position_owner: Pubkey,
        position_organization: Pubkey,
        position_schedule: Pubkey,
        position_id: u64,
        beneficiary_commitment: [u8; 32],
        encrypted_total_amount: [u8; 32],
        encrypted_claimed_amount: [u8; 32],
        position_nonce: u128,
        position_start_timestamp: i64,
        position_is_active: u8,
        position_is_fully_claimed: u8,
        // Claim params:
        nullifier: [u8; 32],
        withdrawal_destination: Pubkey,
    ) -> Result<()> {
        // 1. Verify organization is active
        require!(ctx.accounts.organization.is_active, ShadowVestError::OrganizationNotActive);

        // 2. Verify position is active and not fully claimed
        require!(position_is_active == 1, ShadowVestError::PositionNotActive);
        require!(position_is_fully_claimed == 0, ShadowVestError::PositionFullyClaimed);

        // 3. Verify position belongs to this organization
        require!(
            position_organization == ctx.accounts.organization.key(),
            ShadowVestError::InvalidPositionOrganization
        );

        // 4. Deserialize Light Protocol types
        let proof: ValidityProof = borsh::BorshDeserialize::try_from_slice(&proof_bytes)
            .map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;
        let account_meta: CompressedAccountMeta =
            borsh::BorshDeserialize::try_from_slice(&account_meta_bytes)
                .map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;

        // 5. Initialize CPI accounts for Light Protocol
        let cpi_accounts = CpiAccounts::new(
            ctx.accounts.fee_payer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // 6. Get the address from account_meta (set during creation)
        let address = account_meta.address;

        // 7. Load the existing compressed position via Light Protocol
        //    This verifies the data matches what's in the Merkle tree
        let compressed_position = LightAccount::<CompressedVestingPosition>::new_mut(
            &crate::ID,
            &account_meta,
            CompressedVestingPosition {
                owner: position_owner,
                organization: position_organization,
                schedule: position_schedule,
                position_id,
                beneficiary_commitment,
                encrypted_total_amount,
                encrypted_claimed_amount,
                nonce: position_nonce,
                start_timestamp: position_start_timestamp,
                is_active: position_is_active,
                is_fully_claimed: position_is_fully_claimed,
            },
        ).map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;

        // 8. Verify Ed25519 signature (same as regular authorize_claim)
        let ix_sysvar = &ctx.accounts.instructions_sysvar;
        let current_ix_index = sysvar_instructions::load_current_index_checked(ix_sysvar)
            .map_err(|_| ShadowVestError::InvalidEligibilitySignature)?;
        require!(current_ix_index > 0, ShadowVestError::InvalidEligibilitySignature);

        let ed25519_ix = sysvar_instructions::load_instruction_at_checked(
            (current_ix_index - 1) as usize,
            ix_sysvar,
        ).map_err(|_| ShadowVestError::InvalidEligibilitySignature)?;

        require!(
            ed25519_ix.program_id == ED25519_PROGRAM_ID,
            ShadowVestError::InvalidEligibilitySignature
        );
        require!(ed25519_ix.data.len() >= 16, ShadowVestError::InvalidEligibilitySignature);

        let num_signatures = ed25519_ix.data[0];
        require!(num_signatures == 1, ShadowVestError::InvalidEligibilitySignature);

        let pubkey_offset = u16::from_le_bytes([ed25519_ix.data[6], ed25519_ix.data[7]]) as usize;
        require!(
            ed25519_ix.data.len() >= pubkey_offset + 32,
            ShadowVestError::InvalidEligibilitySignature
        );
        let signer_pubkey = &ed25519_ix.data[pubkey_offset..pubkey_offset + 32];

        // Verify signer matches beneficiary_commitment
        require!(
            signer_pubkey == beneficiary_commitment,
            ShadowVestError::SignerMismatch
        );

        // Verify message content: position_id || nullifier || withdrawal_destination
        let message_data_offset = u16::from_le_bytes([ed25519_ix.data[10], ed25519_ix.data[11]]) as usize;
        let message_data_size = u16::from_le_bytes([ed25519_ix.data[12], ed25519_ix.data[13]]) as usize;
        require!(
            ed25519_ix.data.len() >= message_data_offset + message_data_size,
            ShadowVestError::InvalidEligibilitySignature
        );
        let signed_message = &ed25519_ix.data[message_data_offset..message_data_offset + message_data_size];

        let mut expected_msg = [0u8; 72];
        expected_msg[..8].copy_from_slice(&position_id.to_le_bytes());
        expected_msg[8..40].copy_from_slice(&nullifier);
        expected_msg[40..72].copy_from_slice(withdrawal_destination.as_ref());

        require!(
            signed_message == expected_msg,
            ShadowVestError::InvalidEligibilitySignature
        );

        // 9. Verify compressed position exists via Light Protocol CPI
        //    We pass the same data as output (no state change here).
        LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(compressed_position)?
            .invoke(cpi_accounts)?;

        // 10. Initialize ClaimAuthorization
        let clock = Clock::get()?;
        let claim_auth = &mut ctx.accounts.claim_authorization;
        claim_auth.position = Pubkey::new_from_array(address);
        claim_auth.nullifier = nullifier;
        claim_auth.withdrawal_destination = withdrawal_destination;
        claim_auth.claim_amount = 0;
        claim_auth.is_authorized = true;
        claim_auth.is_processed = false;
        claim_auth.is_withdrawn = false;
        claim_auth.authorized_at = clock.unix_timestamp;
        claim_auth.bump = ctx.bumps.claim_authorization;

        // 11. Initialize NullifierRecord
        let nullifier_record = &mut ctx.accounts.nullifier_record;
        nullifier_record.nullifier = nullifier;
        nullifier_record.position = Pubkey::new_from_array(address);
        nullifier_record.used_at = clock.unix_timestamp;
        nullifier_record.bump = ctx.bumps.nullifier_record;

        emit!(ClaimAuthorized {
            position: Pubkey::new_from_array(address),
            nullifier,
            withdrawal_destination,
        });

        Ok(())
    }

    /// Queue MPC computation for a compressed position claim.
    /// Computes vesting_numerator on-chain from Clock + schedule parameters.
    pub fn queue_process_claim_compressed(
        ctx: Context<QueueProcessClaimCompressed>,
        computation_offset: u64,
        position_id: u64,
        encrypted_total_amount: [u8; 32],
        encrypted_claimed_amount: [u8; 32],
        encrypted_vesting_numerator: [u8; 32],
        encrypted_claim_amount: [u8; 32],
        claim_amount: u64,
        start_timestamp: i64,
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        require!(ctx.accounts.claim_authorization.is_authorized, ShadowVestError::ClaimNotAuthorized);
        require!(!ctx.accounts.claim_authorization.is_processed, ShadowVestError::ClaimNotProcessed);

        // Capture position key before mutable borrow
        let claim_position = ctx.accounts.claim_authorization.position;

        let schedule = &ctx.accounts.schedule;

        // Compute vesting_numerator on-chain
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let cliff_end = start_timestamp + schedule.cliff_duration as i64;
        let vesting_end = start_timestamp + schedule.total_duration as i64;

        const PRECISION: u64 = 1_000_000;
        let vesting_numerator = if current_time < cliff_end {
            0u64
        } else if current_time >= vesting_end {
            PRECISION
        } else {
            let elapsed = (current_time - cliff_end) as u64;
            let intervals = elapsed / schedule.vesting_interval;
            let vested_seconds = intervals * schedule.vesting_interval;
            let vesting_duration = schedule.total_duration - schedule.cliff_duration;
            if vesting_duration > 0 {
                vested_seconds * PRECISION / vesting_duration
            } else {
                PRECISION
            }
        };

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_total_amount)
            .encrypted_u64(encrypted_claimed_amount)
            .encrypted_u64(encrypted_vesting_numerator)
            .encrypted_u64(encrypted_claim_amount)
            .build();

        let position_callback_account = CallbackAccount {
            pubkey: ctx.accounts.position.key(),
            is_writable: true,
        };
        let claim_auth_callback_account = CallbackAccount {
            pubkey: ctx.accounts.claim_authorization.key(),
            is_writable: true,
        };

        let callback_ix = ProcessClaimV2Callback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[position_callback_account, claim_auth_callback_account],
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

        let claim_auth_mut = &mut ctx.accounts.claim_authorization;
        claim_auth_mut.claim_amount = claim_amount;

        emit!(ClaimProcessQueued {
            position: claim_position,
            position_id,
            claim_amount,
            computation_offset,
            vesting_numerator,
        });

        Ok(())
    }

    /// Update the encrypted_claimed_amount on a compressed vesting position.
    ///
    /// Called after process_claim_v2_compressed_callback() confirms the claim is valid.
    /// This updates the Light Protocol Merkle tree with the new claimed amount.
    ///
    /// Can only be called when the associated ClaimAuthorization is_processed=true
    /// and is_withdrawn=false (prevents unauthorized updates).
    pub fn update_compressed_position_claimed<'info>(
        ctx: Context<'_, '_, '_, 'info, UpdateCompressedPositionClaimed<'info>>,
        proof_bytes: Vec<u8>,
        account_meta_bytes: Vec<u8>,
        // Current compressed position data:
        position_owner: Pubkey,
        position_organization: Pubkey,
        position_schedule: Pubkey,
        position_id: u64,
        beneficiary_commitment: [u8; 32],
        encrypted_total_amount: [u8; 32],
        encrypted_claimed_amount: [u8; 32],
        position_nonce: u128,
        position_start_timestamp: i64,
        position_is_active: u8,
        position_is_fully_claimed: u8,
        // New values:
        new_encrypted_claimed_amount: [u8; 32],
        new_is_fully_claimed: u8,
    ) -> Result<()> {
        let claim_auth = &ctx.accounts.claim_authorization;
        require!(claim_auth.is_authorized, ShadowVestError::ClaimNotAuthorized);
        require!(claim_auth.is_processed, ShadowVestError::ClaimNotProcessed);
        require!(!claim_auth.is_withdrawn, ShadowVestError::AlreadyWithdrawn);

        // Verify position belongs to organization
        require!(
            position_organization == ctx.accounts.organization.key(),
            ShadowVestError::InvalidPositionOrganization
        );

        // Deserialize Light Protocol types
        let proof: ValidityProof = borsh::BorshDeserialize::try_from_slice(&proof_bytes)
            .map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;
        let account_meta: CompressedAccountMeta =
            borsh::BorshDeserialize::try_from_slice(&account_meta_bytes)
                .map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;

        let cpi_accounts = CpiAccounts::new(
            ctx.accounts.fee_payer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Get the address from account_meta
        let address = account_meta.address;

        // Load existing compressed position for mutation
        let mut compressed_position = LightAccount::<CompressedVestingPosition>::new_mut(
            &crate::ID,
            &account_meta,
            CompressedVestingPosition {
                owner: position_owner,
                organization: position_organization,
                schedule: position_schedule,
                position_id,
                beneficiary_commitment,
                encrypted_total_amount,
                encrypted_claimed_amount,
                nonce: position_nonce,
                start_timestamp: position_start_timestamp,
                is_active: position_is_active,
                is_fully_claimed: position_is_fully_claimed,
            },
        ).map_err(|_| ShadowVestError::LightProtocolCpiFailed)?;

        // Update the claimed amount and fully_claimed flag
        compressed_position.encrypted_claimed_amount = new_encrypted_claimed_amount;
        compressed_position.is_fully_claimed = new_is_fully_claimed;

        // Execute Light Protocol CPI to commit the state transition
        LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(compressed_position)?
            .invoke(cpi_accounts)?;

        emit!(CompressedPositionClaimUpdated {
            organization: ctx.accounts.organization.key(),
            position_id,
            address,
            new_is_fully_claimed: new_is_fully_claimed == 1,
        });

        Ok(())
    }

    /// Withdraw tokens from the organization vault for a compressed position claim.
    ///
    /// Similar to withdraw() but uses ClaimAuthorization derived from compressed position seeds
    /// (organization + position_id + nullifier) instead of regular position account key.
    pub fn withdraw_compressed(
        ctx: Context<WithdrawCompressed>,
        _position_id: u64,
        _nullifier: [u8; 32],
    ) -> Result<()> {
        let claim_auth = &ctx.accounts.claim_authorization;
        require!(claim_auth.is_authorized, ShadowVestError::ClaimNotAuthorized);
        require!(claim_auth.is_processed, ShadowVestError::ClaimNotProcessed);
        require!(!claim_auth.is_withdrawn, ShadowVestError::AlreadyWithdrawn);
        require!(
            ctx.accounts.destination.key() == claim_auth.withdrawal_destination,
            ShadowVestError::InvalidWithdrawalDestination
        );

        let amount = claim_auth.claim_amount;
        require!(
            ctx.accounts.vault.amount >= amount,
            ShadowVestError::InsufficientVaultBalance
        );

        let org_key = ctx.accounts.organization.key();
        let bump = ctx.bumps.vault_authority;
        let vault_authority_seeds: &[&[u8]] = &[
            b"vault_authority",
            org_key.as_ref(),
            std::slice::from_ref(&bump),
        ];
        let signer_seeds = &[vault_authority_seeds];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, amount)?;

        let claim_auth_mut = &mut ctx.accounts.claim_authorization;
        claim_auth_mut.is_withdrawn = true;

        emit!(ClaimWithdrawn {
            position: claim_auth_mut.position,
            destination: claim_auth_mut.withdrawal_destination,
            amount,
            token_mint: ctx.accounts.vault.mint,
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

    // ============================================================
    // Groth16 ZK Proof Verification (Noir Circuits)
    // ============================================================

    /// Store a verification key on-chain for a specific Noir circuit.
    ///
    /// Only the designated authority (DAO admin) can store VKs.
    /// The VK is derived from the circuit's trusted setup and contains
    /// the parameters needed for Groth16 proof verification.
    ///
    /// Each circuit type (withdrawal_proof, identity_proof, eligibility)
    /// has a unique circuit_id derived as sha256(circuit_name).
    ///
    /// # Arguments
    /// * `circuit_id` - 32-byte identifier for the circuit
    /// * `vk_data` - Serialized VerificationKey bytes
    pub fn store_verification_key(
        ctx: Context<StoreVerificationKey>,
        circuit_id: [u8; 32],
        vk_data: Vec<u8>,
    ) -> Result<()> {
        require!(
            vk_data.len() <= VerificationKeyAccount::MAX_VK_DATA_SIZE,
            ShadowVestError::InvalidVerificationKeyData
        );

        // Validate the VK data can be deserialized
        let _vk: VerificationKey = AnchorDeserialize::try_from_slice(&vk_data)
            .map_err(|_| ShadowVestError::InvalidVerificationKeyData)?;

        let vk_account = &mut ctx.accounts.vk_account;
        vk_account.authority = ctx.accounts.authority.key();
        vk_account.circuit_id = circuit_id;
        vk_account.vk_data = vk_data;
        vk_account.is_active = true;
        vk_account.bump = ctx.bumps.vk_account;

        emit!(VerificationKeyStored {
            authority: vk_account.authority,
            circuit_id,
            vk_account: vk_account.key(),
        });

        Ok(())
    }

    /// Update a verification key (e.g., after a new trusted setup).
    ///
    /// Only the original authority can update. This allows key rotation
    /// without changing the circuit_id PDA.
    pub fn update_verification_key(
        ctx: Context<UpdateVerificationKey>,
        vk_data: Vec<u8>,
    ) -> Result<()> {
        require!(
            vk_data.len() <= VerificationKeyAccount::MAX_VK_DATA_SIZE,
            ShadowVestError::InvalidVerificationKeyData
        );

        // Validate the VK data can be deserialized
        let _vk: VerificationKey = AnchorDeserialize::try_from_slice(&vk_data)
            .map_err(|_| ShadowVestError::InvalidVerificationKeyData)?;

        let vk_account = &mut ctx.accounts.vk_account;
        vk_account.vk_data = vk_data;

        emit!(VerificationKeyUpdated {
            circuit_id: vk_account.circuit_id,
            vk_account: vk_account.key(),
        });

        Ok(())
    }

    /// Verify a withdrawal proof on-chain.
    ///
    /// Performs Groth16 verification using the stored VK for the withdrawal circuit.
    /// On success, creates a ProofRecord PDA that other instructions can reference.
    ///
    /// The withdrawal proof demonstrates:
    /// - Knowledge of a valid vesting position in the state tree
    /// - The position is in the correct epoch
    /// - The nullifier has not been used before
    /// - The prover is entitled to the withdrawal
    ///
    /// Requires ~1,400,000 compute units (pairing is expensive).
    pub fn verify_withdrawal_proof(
        ctx: Context<VerifyWithdrawalProof>,
        proof: Groth16Proof,
        public_inputs: WithdrawalPublicInputs,
    ) -> Result<()> {
        let vk_account = &ctx.accounts.vk_account;
        require!(vk_account.is_active, ShadowVestError::VerificationKeyNotActive);

        // Deserialize the verification key
        let vk: VerificationKey = AnchorDeserialize::try_from_slice(&vk_account.vk_data)
            .map_err(|_| ShadowVestError::InvalidVerificationKeyData)?;

        // Convert public inputs to scalars
        let scalars = public_inputs.to_scalars();

        // Perform Groth16 verification
        let is_valid = groth16_verifier::verify_groth16(&vk, &proof, &scalars)?;
        require!(is_valid, ShadowVestError::ProofVerificationFailed);

        // Create proof record
        let clock = Clock::get()?;
        let proof_record = &mut ctx.accounts.proof_record;
        proof_record.verifier = ctx.accounts.verifier.key();
        proof_record.circuit_id = vk_account.circuit_id;
        proof_record.nullifier = public_inputs.nullifier;
        proof_record.verified_at = clock.unix_timestamp;
        proof_record.is_valid = true;
        proof_record.bump = ctx.bumps.proof_record;

        emit!(ProofVerified {
            verifier: proof_record.verifier,
            circuit_id: proof_record.circuit_id,
            nullifier: proof_record.nullifier,
            proof_type: ProofType::Withdrawal,
            verified_at: proof_record.verified_at,
        });

        Ok(())
    }

    /// Verify an identity proof on-chain.
    ///
    /// The identity proof demonstrates knowledge of the secret behind
    /// a position commitment, without revealing the secret itself.
    /// This is used to prove ownership of a vesting position.
    ///
    /// Creates a ProofRecord keyed by position_commitment as the nullifier.
    pub fn verify_identity_proof(
        ctx: Context<VerifyIdentityProof>,
        proof: Groth16Proof,
        public_inputs: IdentityPublicInputs,
    ) -> Result<()> {
        let vk_account = &ctx.accounts.vk_account;
        require!(vk_account.is_active, ShadowVestError::VerificationKeyNotActive);

        // Deserialize the verification key
        let vk: VerificationKey = AnchorDeserialize::try_from_slice(&vk_account.vk_data)
            .map_err(|_| ShadowVestError::InvalidVerificationKeyData)?;

        // Convert public inputs to scalars
        let scalars = public_inputs.to_scalars();

        // Perform Groth16 verification
        let is_valid = groth16_verifier::verify_groth16(&vk, &proof, &scalars)?;
        require!(is_valid, ShadowVestError::ProofVerificationFailed);

        // Create proof record (use position_commitment as nullifier for identity proofs)
        let clock = Clock::get()?;
        let proof_record = &mut ctx.accounts.proof_record;
        proof_record.verifier = ctx.accounts.verifier.key();
        proof_record.circuit_id = vk_account.circuit_id;
        proof_record.nullifier = public_inputs.position_commitment;
        proof_record.verified_at = clock.unix_timestamp;
        proof_record.is_valid = true;
        proof_record.bump = ctx.bumps.proof_record;

        emit!(ProofVerified {
            verifier: proof_record.verifier,
            circuit_id: proof_record.circuit_id,
            nullifier: proof_record.nullifier,
            proof_type: ProofType::Identity,
            verified_at: proof_record.verified_at,
        });

        Ok(())
    }

    /// Verify an eligibility proof on-chain.
    ///
    /// The eligibility proof demonstrates:
    /// - The prover is the designated beneficiary of a position
    /// - The nullifier has not been used (prevents double-claim)
    /// - The prover knows the opening to the position commitment
    ///
    /// This is the primary proof used in the claim-withdraw flow,
    /// replacing or augmenting the Ed25519 signature verification.
    pub fn verify_eligibility_proof(
        ctx: Context<VerifyEligibilityProof>,
        proof: Groth16Proof,
        public_inputs: EligibilityPublicInputs,
    ) -> Result<()> {
        let vk_account = &ctx.accounts.vk_account;
        require!(vk_account.is_active, ShadowVestError::VerificationKeyNotActive);

        // Deserialize the verification key
        let vk: VerificationKey = AnchorDeserialize::try_from_slice(&vk_account.vk_data)
            .map_err(|_| ShadowVestError::InvalidVerificationKeyData)?;

        // Convert public inputs to scalars
        let scalars = public_inputs.to_scalars();

        // Perform Groth16 verification
        let is_valid = groth16_verifier::verify_groth16(&vk, &proof, &scalars)?;
        require!(is_valid, ShadowVestError::ProofVerificationFailed);

        // Create proof record
        let clock = Clock::get()?;
        let proof_record = &mut ctx.accounts.proof_record;
        proof_record.verifier = ctx.accounts.verifier.key();
        proof_record.circuit_id = vk_account.circuit_id;
        proof_record.nullifier = public_inputs.nullifier;
        proof_record.verified_at = clock.unix_timestamp;
        proof_record.is_valid = true;
        proof_record.bump = ctx.bumps.proof_record;

        emit!(ProofVerified {
            verifier: proof_record.verifier,
            circuit_id: proof_record.circuit_id,
            nullifier: proof_record.nullifier,
            proof_type: ProofType::Eligibility,
            verified_at: proof_record.verified_at,
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

#[init_computation_definition_accounts("process_claim_v2", payer)]
#[derive(Accounts)]
pub struct InitProcessClaimV2CompDef<'info> {
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
// Account Contexts - Claim Authorization & Withdrawal
// ============================================================

#[derive(Accounts)]
#[instruction(nullifier: [u8; 32])]
pub struct AuthorizeClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, organization.admin.as_ref()],
        bump = organization.bump,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        seeds = [VestingPosition::SEED_PREFIX, organization.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        constraint = position.organization == organization.key() @ ShadowVestError::InvalidPositionOrganization,
    )]
    pub position: Account<'info, VestingPosition>,

    #[account(
        init,
        payer = payer,
        space = ClaimAuthorization::SIZE,
        seeds = [ClaimAuthorization::SEED_PREFIX, position.key().as_ref(), nullifier.as_ref()],
        bump,
    )]
    pub claim_authorization: Account<'info, ClaimAuthorization>,

    #[account(
        init,
        payer = payer,
        space = NullifierRecord::SIZE,
        seeds = [NullifierRecord::SEED_PREFIX, organization.key().as_ref(), nullifier.as_ref()],
        bump,
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,

    /// CHECK: Instructions sysvar for reading Ed25519 instruction
    #[account(address = sysvar_instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("process_claim_v2", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueProcessClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, organization.admin.as_ref()],
        bump = organization.bump,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        seeds = [VestingSchedule::SEED_PREFIX, organization.key().as_ref(), schedule.schedule_id.to_le_bytes().as_ref()],
        bump = schedule.bump,
        constraint = schedule.organization == organization.key() @ ShadowVestError::InvalidScheduleParams,
    )]
    pub schedule: Box<Account<'info, VestingSchedule>>,

    #[account(
        seeds = [VestingPosition::SEED_PREFIX, organization.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        constraint = position.organization == organization.key() @ ShadowVestError::InvalidPositionOrganization,
        constraint = position.schedule == schedule.key() @ ShadowVestError::InvalidScheduleParams,
    )]
    pub position: Box<Account<'info, VestingPosition>>,

    #[account(
        mut,
        seeds = [ClaimAuthorization::SEED_PREFIX, position.key().as_ref(), claim_authorization.nullifier.as_ref()],
        bump = claim_authorization.bump,
        constraint = claim_authorization.position == position.key() @ ShadowVestError::InvalidPositionOrganization,
    )]
    pub claim_authorization: Account<'info, ClaimAuthorization>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROCESS_CLAIM_V2))]
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

#[callback_accounts("process_claim_v2")]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ProcessClaimV2Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROCESS_CLAIM_V2))]
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
    #[account(mut)]
    pub claim_authorization: Account<'info, ClaimAuthorization>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, admin.key().as_ref()],
        bump = organization.bump,
        has_one = admin @ ShadowVestError::UnauthorizedAdmin,
    )]
    pub organization: Account<'info, Organization>,

    /// CHECK: Vault authority PDA - used as token account authority
    #[account(
        seeds = [b"vault_authority", organization.key().as_ref()],
        bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(
        init,
        payer = admin,
        token::mint = token_mint,
        token::authority = vault_authority,
        seeds = [b"vault", organization.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, token::Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositToVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, admin.key().as_ref()],
        bump = organization.bump,
        has_one = admin @ ShadowVestError::UnauthorizedAdmin,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        mut,
        token::mint = organization.token_mint,
        seeds = [b"vault", organization.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = organization.token_mint,
        token::authority = admin,
    )]
    pub admin_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, organization.admin.as_ref()],
        bump = organization.bump,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        seeds = [VestingPosition::SEED_PREFIX, organization.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        constraint = position.organization == organization.key() @ ShadowVestError::InvalidPositionOrganization,
    )]
    pub position: Account<'info, VestingPosition>,

    #[account(
        mut,
        seeds = [ClaimAuthorization::SEED_PREFIX, position.key().as_ref(), claim_authorization.nullifier.as_ref()],
        bump = claim_authorization.bump,
        constraint = claim_authorization.position == position.key() @ ShadowVestError::InvalidPositionOrganization,
    )]
    pub claim_authorization: Account<'info, ClaimAuthorization>,

    /// CHECK: Vault authority PDA
    #[account(
        seeds = [b"vault_authority", organization.key().as_ref()],
        bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"vault", organization.key().as_ref()],
        bump,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ============================================================
// Account Contexts - Compressed Position Claim & Withdraw
// ============================================================

#[derive(Accounts)]
#[instruction(
    proof_bytes: Vec<u8>,
    account_meta_bytes: Vec<u8>,
    position_owner: Pubkey,
    position_organization: Pubkey,
    position_schedule: Pubkey,
    position_id: u64,
    beneficiary_commitment: [u8; 32],
    encrypted_total_amount: [u8; 32],
    encrypted_claimed_amount: [u8; 32],
    position_nonce: u128,
    position_start_timestamp: i64,
    position_is_active: u8,
    position_is_fully_claimed: u8,
    nullifier: [u8; 32],
    withdrawal_destination: Pubkey,
)]
pub struct AuthorizeClaimCompressed<'info> {
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, organization.admin.as_ref()],
        bump = organization.bump,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        init,
        payer = fee_payer,
        space = ClaimAuthorization::SIZE,
        seeds = [
            ClaimAuthorization::SEED_PREFIX,
            organization.key().as_ref(),
            &position_id.to_le_bytes(),
            nullifier.as_ref(),
        ],
        bump,
    )]
    pub claim_authorization: Account<'info, ClaimAuthorization>,

    #[account(
        init,
        payer = fee_payer,
        space = NullifierRecord::SIZE,
        seeds = [NullifierRecord::SEED_PREFIX, organization.key().as_ref(), nullifier.as_ref()],
        bump,
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,

    /// CHECK: Instructions sysvar for Ed25519 verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("process_claim_v2", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueProcessClaimCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, organization.admin.as_ref()],
        bump = organization.bump,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        seeds = [VestingSchedule::SEED_PREFIX, organization.key().as_ref(), schedule.schedule_id.to_le_bytes().as_ref()],
        bump = schedule.bump,
    )]
    pub schedule: Account<'info, VestingSchedule>,

    /// Scratch position account used as a callback target.
    /// For compressed positions, the callback writes encrypted_claimed_amount here
    /// (the real state lives in Light Protocol and is updated via update_compressed_position_claimed).
    #[account(mut)]
    pub position: Account<'info, VestingPosition>,

    #[account(
        mut,
        constraint = claim_authorization.is_authorized @ ShadowVestError::ClaimNotAuthorized,
    )]
    pub claim_authorization: Account<'info, ClaimAuthorization>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROCESS_CLAIM_V2))]
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

#[derive(Accounts)]
pub struct UpdateCompressedPositionClaimed<'info> {
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, organization.admin.as_ref()],
        bump = organization.bump,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        constraint = claim_authorization.is_processed @ ShadowVestError::ClaimNotProcessed,
        constraint = !claim_authorization.is_withdrawn @ ShadowVestError::AlreadyWithdrawn,
    )]
    pub claim_authorization: Account<'info, ClaimAuthorization>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(position_id: u64, nullifier: [u8; 32])]
pub struct WithdrawCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [Organization::SEED_PREFIX, organization.admin.as_ref()],
        bump = organization.bump,
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        mut,
        seeds = [
            ClaimAuthorization::SEED_PREFIX,
            organization.key().as_ref(),
            &position_id.to_le_bytes(),
            nullifier.as_ref(),
        ],
        bump = claim_authorization.bump,
    )]
    pub claim_authorization: Account<'info, ClaimAuthorization>,

    /// CHECK: Vault authority PDA
    #[account(
        seeds = [b"vault_authority", organization.key().as_ref()],
        bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        token::authority = vault_authority,
        seeds = [b"vault", organization.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
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
// Account Contexts - Groth16 Proof Verification
// ============================================================

/// Context for storing a verification key on-chain.
/// Only the authority (admin) can store VKs for circuit verification.
#[derive(Accounts)]
#[instruction(circuit_id: [u8; 32], vk_data: Vec<u8>)]
pub struct StoreVerificationKey<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = VerificationKeyAccount::size_with_vk_data(vk_data.len()),
        seeds = [VerificationKeyAccount::SEED_PREFIX, circuit_id.as_ref()],
        bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    pub system_program: Program<'info, System>,
}

/// Context for updating an existing verification key.
#[derive(Accounts)]
pub struct UpdateVerificationKey<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VerificationKeyAccount::SEED_PREFIX, vk_account.circuit_id.as_ref()],
        bump = vk_account.bump,
        has_one = authority @ ShadowVestError::UnauthorizedAdmin,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,
}

/// Context for verifying a withdrawal proof.
/// Creates a ProofRecord PDA keyed by [b"proof_record", verifier, nullifier].
#[derive(Accounts)]
#[instruction(proof: Groth16Proof, public_inputs: WithdrawalPublicInputs)]
pub struct VerifyWithdrawalProof<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,

    /// The verification key account for the withdrawal circuit
    #[account(
        seeds = [VerificationKeyAccount::SEED_PREFIX, vk_account.circuit_id.as_ref()],
        bump = vk_account.bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    /// Proof record PDA - proves this verification happened on-chain.
    /// Keyed by verifier + nullifier to prevent duplicate records.
    #[account(
        init,
        payer = verifier,
        space = ProofRecord::SIZE,
        seeds = [ProofRecord::SEED_PREFIX, verifier.key().as_ref(), public_inputs.nullifier.as_ref()],
        bump,
    )]
    pub proof_record: Account<'info, ProofRecord>,

    pub system_program: Program<'info, System>,
}

/// Context for verifying an identity proof.
/// Creates a ProofRecord keyed by [b"proof_record", verifier, position_commitment].
#[derive(Accounts)]
#[instruction(proof: Groth16Proof, public_inputs: IdentityPublicInputs)]
pub struct VerifyIdentityProof<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,

    /// The verification key account for the identity circuit
    #[account(
        seeds = [VerificationKeyAccount::SEED_PREFIX, vk_account.circuit_id.as_ref()],
        bump = vk_account.bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    /// Proof record PDA keyed by position_commitment (used as nullifier for identity proofs)
    #[account(
        init,
        payer = verifier,
        space = ProofRecord::SIZE,
        seeds = [ProofRecord::SEED_PREFIX, verifier.key().as_ref(), public_inputs.position_commitment.as_ref()],
        bump,
    )]
    pub proof_record: Account<'info, ProofRecord>,

    pub system_program: Program<'info, System>,
}

/// Context for verifying an eligibility proof.
/// Creates a ProofRecord keyed by [b"proof_record", verifier, nullifier].
#[derive(Accounts)]
#[instruction(proof: Groth16Proof, public_inputs: EligibilityPublicInputs)]
pub struct VerifyEligibilityProof<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,

    /// The verification key account for the eligibility circuit
    #[account(
        seeds = [VerificationKeyAccount::SEED_PREFIX, vk_account.circuit_id.as_ref()],
        bump = vk_account.bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    /// Proof record PDA keyed by nullifier (prevents double-verification)
    #[account(
        init,
        payer = verifier,
        space = ProofRecord::SIZE,
        seeds = [ProofRecord::SEED_PREFIX, verifier.key().as_ref(), public_inputs.nullifier.as_ref()],
        bump,
    )]
    pub proof_record: Account<'info, ProofRecord>,

    pub system_program: Program<'info, System>,
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

#[event]
pub struct VaultDeposited {
    pub organization: Pubkey,
    pub vault: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CompressedClaimProcessed {
    pub position: Pubkey,
    pub claim_amount: u64,
    pub new_encrypted_claimed: [u8; 32],
    pub is_valid: u64,
}

#[event]
pub struct CompressedPositionClaimUpdated {
    pub organization: Pubkey,
    pub position_id: u64,
    pub address: [u8; 32],
    pub new_is_fully_claimed: bool,
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

// Phase 5: Claim & Withdrawal Events

#[event]
pub struct ClaimAuthorized {
    pub position: Pubkey,
    pub nullifier: [u8; 32],
    pub withdrawal_destination: Pubkey,
}

#[event]
pub struct ClaimProcessQueued {
    pub position: Pubkey,
    pub position_id: u64,
    pub claim_amount: u64,
    pub computation_offset: u64,
    pub vesting_numerator: u64,
}

#[event]
pub struct ClaimProcessed {
    pub position: Pubkey,
    pub position_id: u64,
    pub claim_amount: u64,
}

#[event]
pub struct VaultInitialized {
    pub organization: Pubkey,
    pub vault: Pubkey,
    pub vault_authority: Pubkey,
    pub token_mint: Pubkey,
}

#[event]
pub struct ClaimWithdrawn {
    pub position: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
}

// Phase 6: Groth16 Proof Verification Events

#[event]
pub struct VerificationKeyStored {
    pub authority: Pubkey,
    pub circuit_id: [u8; 32],
    pub vk_account: Pubkey,
}

#[event]
pub struct VerificationKeyUpdated {
    pub circuit_id: [u8; 32],
    pub vk_account: Pubkey,
}

#[event]
pub struct ProofVerified {
    pub verifier: Pubkey,
    pub circuit_id: [u8; 32],
    pub nullifier: [u8; 32],
    pub proof_type: ProofType,
    pub verified_at: i64,
}

/// Type of ZK proof being verified.
/// Used in events and for circuit identification.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum ProofType {
    /// Withdrawal proof - proves entitlement to withdraw from a position
    Withdrawal,
    /// Identity proof - proves knowledge of position secret
    Identity,
    /// Eligibility proof - proves beneficiary status without revealing identity
    Eligibility,
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
