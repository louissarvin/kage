use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod errors;
pub mod state;

use errors::ShadowVestError;
use state::{Organization, VestingPosition, VestingSchedule};

// Computation definition offsets for Arcium circuits
const COMP_DEF_OFFSET_INIT_POSITION: u32 = comp_def_offset("init_position");
const COMP_DEF_OFFSET_CALCULATE_VESTED: u32 = comp_def_offset("calculate_vested");
const COMP_DEF_OFFSET_PROCESS_CLAIM: u32 = comp_def_offset("process_claim");

declare_id!("5wCRYkx2RqFNZB1554z2Vxmp2Rm7H2EEVcCrMxoquT5T");

#[arcium_program]
pub mod contract {
    use super::*;

    // ============================================================
    // Computation Definition Initialization
    // ============================================================

    pub fn init_init_position_comp_def(ctx: Context<InitInitPositionCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_calculate_vested_comp_def(ctx: Context<InitCalculateVestedCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_process_claim_comp_def(ctx: Context<InitProcessClaimCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
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

        let callback_ix = InitPositionCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[],
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
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let position = &ctx.accounts.position;
        let schedule = &ctx.accounts.schedule;

        require!(position.is_active, ShadowVestError::PositionNotActive);
        require!(!position.is_fully_claimed, ShadowVestError::PositionFullyClaimed);

        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp as u64;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(position.encrypted_total_amount)
            .encrypted_u64(position.encrypted_claimed_amount)
            .plaintext_u64(schedule.cliff_duration)
            .plaintext_u64(schedule.total_duration)
            .plaintext_u64(schedule.vesting_interval)
            .plaintext_u64(position.start_timestamp as u64)
            .plaintext_u64(current_timestamp)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CalculateVestedCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
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
        seeds = [SIGN_PDA_SEED.as_ref()],
        bump,
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
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
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
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
        seeds = [SIGN_PDA_SEED.as_ref()],
        bump,
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
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
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
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

const SIGN_PDA_SEED: [u8; 8] = *b"sign_pda";
