#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

declare_id!("BJk7HqbLecWFBFxFTULnmpSwmViLg9FeRLBajewvJ3g4");
pub const DBC: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
pub const DAMM: Pubkey = pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
pub const DOMAIN: &[u8] = b"oneonly:fee-claim:v1:devnet";
pub const MAX_RECIPIENTS: usize = 8;
const POOL_DISC: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];
const CONFIG_DISC: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];

#[program]
pub mod oneonly_fee_escrow {
    use super::*;
    pub fn initialize_config(ctx: Context<InitializeConfig>, verifier: Pubkey) -> Result<()> {
        require!(verifier != Pubkey::default(), EscrowError::InvalidVerifier);
        ctx.accounts.config.verifier = verifier;
        ctx.accounts.config.bump = ctx.bumps.config;
        Ok(())
    }
    pub fn initialize_allocation(
        ctx: Context<InitializeAllocation>,
        shares: Vec<Share>,
    ) -> Result<()> {
        validate_shares(&shares)?;
        validate_mint(&ctx.accounts.base_mint.to_account_info())?;
        validate_mint(&ctx.accounts.quote_mint.to_account_info())?;
        let pool_data = ctx.accounts.pool.try_borrow_data()?;
        let config_data = ctx.accounts.dbc_config.try_borrow_data()?;
        require!(
            pool_data.get(..8) == Some(POOL_DISC.as_slice()),
            EscrowError::InvalidPool
        );
        require!(
            config_data.get(..8) == Some(CONFIG_DISC.as_slice()),
            EscrowError::InvalidPool
        );
        // Existing graduated positions require a separate authority migration.
        // This instruction only opts in a pre-graduation VirtualPool.
        require!(
            pool_data.get(305) == Some(&0) && pool_data.get(308) == Some(&0),
            EscrowError::InvalidPool
        );
        require_keys_eq!(
            read_key(&pool_data, 72)?,
            ctx.accounts.dbc_config.key(),
            EscrowError::InvalidPool
        );
        require_keys_eq!(
            read_key(&pool_data, 104)?,
            ctx.accounts.payer.key(),
            EscrowError::InvalidPool
        );
        require_keys_eq!(
            read_key(&pool_data, 136)?,
            ctx.accounts.base_mint.key(),
            EscrowError::InvalidPool
        );
        require_keys_eq!(
            read_key(&config_data, 8)?,
            ctx.accounts.quote_mint.key(),
            EscrowError::InvalidPool
        );
        require!(
            ctx.accounts.base_mint.key() != ctx.accounts.quote_mint.key(),
            EscrowError::InvalidPool
        );
        drop(pool_data);
        drop(config_data);
        let allocation = &mut ctx.accounts.allocation;
        allocation.pool = ctx.accounts.pool.key();
        allocation.base_mint = ctx.accounts.base_mint.key();
        allocation.quote_mint = ctx.accounts.quote_mint.key();
        allocation.launcher = ctx.accounts.payer.key();
        allocation.bump = ctx.bumps.allocation;
        allocation.shares = shares;
        // The only authority transition offered by this program. No instruction
        // can transfer it back, withdraw liquidity, or invoke arbitrary data.
        let ix = Instruction {
            program_id: DBC,
            data: vec![20, 7, 169, 33, 58, 147, 166, 33],
            accounts: vec![
                AccountMeta::new(ctx.accounts.pool.key(), false),
                AccountMeta::new_readonly(ctx.accounts.dbc_config.key(), false),
                AccountMeta::new_readonly(ctx.accounts.payer.key(), true),
                AccountMeta::new_readonly(allocation.key(), false),
                AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
                AccountMeta::new_readonly(DBC, false),
                AccountMeta::new_readonly(ctx.accounts.migration_metadata.key(), false),
            ],
        };
        invoke(
            &ix,
            &[
                ctx.accounts.pool.to_account_info(),
                ctx.accounts.dbc_config.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                allocation.to_account_info(),
                ctx.accounts.event_authority.to_account_info(),
                ctx.accounts.dbc_program.to_account_info(),
                ctx.accounts.migration_metadata.to_account_info(),
            ],
        )?;
        require_keys_eq!(
            read_key(&ctx.accounts.pool.try_borrow_data()?, 104)?,
            allocation.key(),
            EscrowError::InvalidPool
        );
        emit!(AllocationCreated {
            allocation: allocation.key(),
            pool: allocation.pool,
            shares: allocation.shares.clone()
        });
        Ok(())
    }
    pub fn collect_fees<'info>(
        ctx: Context<'_, '_, '_, 'info, CollectFees<'info>>,
        venue: u8,
    ) -> Result<()> {
        validate_mint(&ctx.accounts.base_mint.to_account_info())?;
        validate_mint(&ctx.accounts.quote_mint.to_account_info())?;
        let allocation = &ctx.accounts.allocation;
        let r = ctx.remaining_accounts;
        let (
            program,
            count,
            creator_index,
            a_index,
            b_index,
            mint_a_index,
            mint_b_index,
            token_a_index,
            token_b_index,
            writable,
            data,
        ) = match venue {
            0 => (
                DBC,
                13,
                8,
                2,
                3,
                6,
                7,
                9,
                10,
                vec![1, 2, 3, 4, 5],
                [
                    vec![82, 220, 250, 189, 3, 85, 107, 45],
                    u64::MAX.to_le_bytes().to_vec(),
                    u64::MAX.to_le_bytes().to_vec(),
                ]
                .concat(),
            ),
            1 => (
                DAMM,
                15,
                10,
                3,
                4,
                7,
                8,
                11,
                12,
                vec![2, 3, 4, 5, 6],
                vec![180, 38, 154, 17, 133, 33, 162, 211],
            ),
            _ => return err!(EscrowError::InvalidVenue),
        };
        require!(r.len() == count, EscrowError::InvalidCollection);
        require_keys_eq!(*r[count - 1].key, program, EscrowError::InvalidCollection);
        require!(r[count - 1].executable, EscrowError::InvalidCollection);
        require_keys_eq!(
            *r[creator_index].key,
            allocation.key(),
            EscrowError::InvalidCollection
        );
        require_keys_eq!(
            *r[a_index].key,
            ctx.accounts.base_account.key(),
            EscrowError::InvalidCollection
        );
        require_keys_eq!(
            *r[b_index].key,
            ctx.accounts.quote_account.key(),
            EscrowError::InvalidCollection
        );
        require_keys_eq!(
            *r[mint_a_index].key,
            allocation.base_mint,
            EscrowError::InvalidCollection
        );
        require_keys_eq!(
            *r[mint_b_index].key,
            allocation.quote_mint,
            EscrowError::InvalidCollection
        );
        require_keys_eq!(
            *r[token_a_index].key,
            ctx.accounts.base_token_program.key(),
            EscrowError::InvalidCollection
        );
        require_keys_eq!(
            *r[token_b_index].key,
            ctx.accounts.quote_token_program.key(),
            EscrowError::InvalidCollection
        );
        if venue == 0 {
            require_keys_eq!(*r[1].key, allocation.pool, EscrowError::InvalidCollection);
        } else {
            // Meteora validates position.pool, NFT mint/amount/owner and the
            // pool's two mints. Require its NFT owner to be this allocation,
            // so delegate permission alone cannot collect unrelated positions.
            let nft_data = r[9].try_borrow_data()?;
            require!(
                *r[9].owner == anchor_spl::token::ID || *r[9].owner == spl_token_2022::ID,
                EscrowError::InvalidCollection
            );
            let nft = StateWithExtensions::<spl_token_2022::state::Account>::unpack(&nft_data)?;
            require_keys_eq!(
                nft.base.owner,
                allocation.key(),
                EscrowError::InvalidCollection
            );
            require!(nft.base.amount == 1, EscrowError::InvalidCollection);
        }
        let before_a = ctx.accounts.base_account.amount;
        let before_b = ctx.accounts.quote_account.amount;
        let metas = r
            .iter()
            .enumerate()
            .map(|(i, a)| {
                if writable.contains(&i) {
                    AccountMeta::new(*a.key, i == creator_index)
                } else {
                    AccountMeta::new_readonly(*a.key, i == creator_index)
                }
            })
            .collect();
        let bump = [allocation.bump];
        let seeds: &[&[u8]] = &[b"allocation", allocation.pool.as_ref(), &bump];
        invoke_signed(
            &Instruction {
                program_id: program,
                accounts: metas,
                data,
            },
            r,
            &[seeds],
        )?;
        ctx.accounts.base_account.reload()?;
        ctx.accounts.quote_account.reload()?;
        let amount_a = ctx
            .accounts
            .base_account
            .amount
            .checked_sub(before_a)
            .ok_or(EscrowError::InvalidCollection)?;
        let amount_b = ctx
            .accounts
            .quote_account
            .amount
            .checked_sub(before_b)
            .ok_or(EscrowError::InvalidCollection)?;
        record_collection(
            &mut ctx.accounts.base_ledger,
            allocation.key(),
            allocation.base_mint,
            amount_a,
        )?;
        record_collection(
            &mut ctx.accounts.quote_ledger,
            allocation.key(),
            allocation.quote_mint,
            amount_b,
        )?;
        emit!(FeesCollected {
            allocation: allocation.key(),
            venue,
            base_amount: amount_a,
            quote_amount: amount_b
        });
        Ok(())
    }
    pub fn claim(ctx: Context<Claim>, args: ClaimArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(args.binding_version == 1, EscrowError::InvalidBinding);
        require!(
            args.issued_at <= now
                && now <= args.expires_at
                && args
                    .expires_at
                    .checked_sub(args.issued_at)
                    .filter(|n| *n > 0 && *n <= 900)
                    .is_some(),
            EscrowError::Expired
        );
        let share = ctx
            .accounts
            .allocation
            .shares
            .iter()
            .find(|s| s.x_id_hash == args.x_id_hash)
            .ok_or(EscrowError::UnknownRecipient)?;
        let expected = claim_message(
            &crate::ID,
            &ctx.accounts.allocation.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.claimant.key(),
            &ctx.accounts.destination.key(),
            &args,
        );
        verify_attestation(
            &ctx.accounts.instructions.to_account_info(),
            &ctx.accounts.config.verifier,
            &expected,
        )?;
        let binding = &mut ctx.accounts.beneficiary;
        if binding.wallet == Pubkey::default() {
            binding.wallet = ctx.accounts.claimant.key();
            binding.x_id_hash = args.x_id_hash;
            binding.version = 1;
        }
        require_keys_eq!(
            binding.wallet,
            ctx.accounts.claimant.key(),
            EscrowError::InvalidBinding
        );
        require!(
            binding.x_id_hash == args.x_id_hash && binding.version == args.binding_version,
            EscrowError::InvalidBinding
        );
        let entitlement = entitlement(ctx.accounts.ledger.total_received, share.bps)?;
        let claimed = &mut ctx.accounts.claimed;
        let cumulative = entitlement.min(args.cumulative_limit);
        let amount = cumulative
            .checked_sub(claimed.amount)
            .filter(|n| *n > 0)
            .ok_or(EscrowError::NothingToClaim)?;
        require!(
            ctx.accounts.vault.amount >= amount,
            EscrowError::InsufficientVault
        );
        validate_mint(&ctx.accounts.mint.to_account_info())?;
        let allocation = &ctx.accounts.allocation;
        let bump = [allocation.bump];
        let seeds: &[&[u8]] = &[b"allocation", allocation.pool.as_ref(), &bump];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: allocation.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        claimed.amount = cumulative;
        let receipt = &mut ctx.accounts.receipt;
        receipt.allocation = allocation.key();
        receipt.mint = ctx.accounts.mint.key();
        receipt.wallet = ctx.accounts.claimant.key();
        receipt.amount = amount;
        receipt.nonce = args.nonce;
        emit!(FeesClaimed {
            allocation: allocation.key(),
            mint: receipt.mint,
            x_id_hash: args.x_id_hash,
            wallet: receipt.wallet,
            amount,
            nonce: args.nonce
        });
        Ok(())
    }
}

fn validate_shares(shares: &[Share]) -> Result<()> {
    require!(
        !shares.is_empty() && shares.len() <= MAX_RECIPIENTS,
        EscrowError::InvalidShares
    );
    let mut sum = 0u32;
    for (i, share) in shares.iter().enumerate() {
        require!(
            share.bps > 0 && share.x_id_hash != [0; 32],
            EscrowError::InvalidShares
        );
        require!(
            !shares[..i].iter().any(|s| s.x_id_hash == share.x_id_hash),
            EscrowError::InvalidShares
        );
        sum += share.bps as u32;
    }
    require!(sum == 10_000, EscrowError::InvalidShares);
    Ok(())
}
fn entitlement(total: u64, bps: u16) -> Result<u64> {
    Ok(((total as u128)
        .checked_mul(bps as u128)
        .ok_or(EscrowError::Overflow)?
        / 10_000) as u64)
}
fn record_collection(
    ledger: &mut Account<Ledger>,
    allocation: Pubkey,
    mint: Pubkey,
    amount: u64,
) -> Result<()> {
    if ledger.allocation == Pubkey::default() {
        ledger.allocation = allocation;
        ledger.mint = mint;
    }
    require_keys_eq!(
        ledger.allocation,
        allocation,
        EscrowError::InvalidCollection
    );
    require_keys_eq!(ledger.mint, mint, EscrowError::InvalidCollection);
    ledger.total_received = ledger
        .total_received
        .checked_add(amount)
        .ok_or(EscrowError::Overflow)?;
    Ok(())
}
fn read_key(bytes: &[u8], offset: usize) -> Result<Pubkey> {
    Ok(Pubkey::new_from_array(
        bytes
            .get(offset..offset + 32)
            .ok_or(EscrowError::InvalidPool)?
            .try_into()
            .map_err(|_| error!(EscrowError::InvalidPool))?,
    ))
}
fn validate_mint(info: &AccountInfo) -> Result<()> {
    if *info.owner == spl_token_2022::ID {
        let data = info.try_borrow_data()?;
        let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data)?;
        for ext in mint.get_extension_types()? {
            require!(
                matches!(
                    ext,
                    ExtensionType::MetadataPointer | ExtensionType::TokenMetadata
                ),
                EscrowError::UnsupportedMint
            );
        }
    }
    Ok(())
}
pub fn claim_message(
    program: &Pubkey,
    allocation: &Pubkey,
    mint: &Pubkey,
    wallet: &Pubkey,
    destination: &Pubkey,
    args: &ClaimArgs,
) -> Vec<u8> {
    [
        DOMAIN,
        program.as_ref(),
        allocation.as_ref(),
        mint.as_ref(),
        &args.x_id_hash,
        wallet.as_ref(),
        destination.as_ref(),
        &args.cumulative_limit.to_le_bytes(),
        &args.binding_version.to_le_bytes(),
        &args.nonce,
        &args.issued_at.to_le_bytes(),
        &args.expires_at.to_le_bytes(),
    ]
    .concat()
}
fn verify_attestation(
    instructions: &AccountInfo,
    verifier: &Pubkey,
    expected: &[u8],
) -> Result<()> {
    let current = load_current_index_checked(instructions)?;
    require!(current > 0, EscrowError::InvalidAttestation);
    let ix = load_instruction_at_checked((current - 1) as usize, instructions)?;
    require_keys_eq!(
        ix.program_id,
        ed25519_program::ID,
        EscrowError::InvalidAttestation
    );
    verify_ed25519_instruction(&ix.data, verifier, expected)
}
fn verify_ed25519_instruction(data: &[u8], verifier: &Pubkey, expected: &[u8]) -> Result<()> {
    require!(
        data.len() >= 16 && data[0] == 1 && data[1] == 0,
        EscrowError::InvalidAttestation
    );
    let field = |i: usize| u16::from_le_bytes([data[i], data[i + 1]]) as usize;
    require!(
        field(4) == 65535 && field(8) == 65535 && field(14) == 65535,
        EscrowError::InvalidAttestation
    );
    require!(
        data.get(field(2)..field(2) + 64).is_some(),
        EscrowError::InvalidAttestation
    );
    require!(
        data.get(field(6)..field(6) + 32) == Some(verifier.as_ref()),
        EscrowError::InvalidAttestation
    );
    require!(
        field(12) == expected.len() && data.get(field(10)..field(10) + field(12)) == Some(expected),
        EscrowError::InvalidAttestation
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer=authority, space=8+32+1, seeds=[b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ EscrowError::InvalidAuthority)]
    pub program: Program<'info, crate::program::OneonlyFeeEscrow>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ EscrowError::InvalidAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializeAllocation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(init,payer=payer,space=8+32*4+1+4+MAX_RECIPIENTS*34,seeds=[b"allocation",pool.key().as_ref()],bump)]
    pub allocation: Account<'info, Allocation>,
    /// CHECK: discriminator and complete identity checked, CPI validates creator authority.
    #[account(mut,owner=DBC)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: discriminator/quote mint checked and its key must match pool config.
    #[account(owner=DBC)]
    pub dbc_config: UncheckedAccount<'info>,
    pub base_mint: InterfaceAccount<'info, Mint>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: pinned executable Meteora program.
    #[account(address=DBC,executable)]
    pub dbc_program: UncheckedAccount<'info>,
    /// CHECK: Meteora validates its event authority.
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: Meteora validates its migration metadata.
    pub migration_metadata: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds=[b"allocation",allocation.pool.as_ref()],bump=allocation.bump,has_one=base_mint,has_one=quote_mint)]
    pub allocation: Account<'info, Allocation>,
    pub base_mint: InterfaceAccount<'info, Mint>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(init_if_needed,payer=payer,space=8+32+32+8,seeds=[b"ledger",allocation.key().as_ref(),base_mint.key().as_ref()],bump)]
    pub base_ledger: Account<'info, Ledger>,
    #[account(init_if_needed,payer=payer,space=8+32+32+8,seeds=[b"ledger",allocation.key().as_ref(),quote_mint.key().as_ref()],bump)]
    pub quote_ledger: Account<'info, Ledger>,
    #[account(init_if_needed,payer=payer,associated_token::mint=base_mint,associated_token::authority=allocation,associated_token::token_program=base_token_program)]
    pub base_account: InterfaceAccount<'info, TokenAccount>,
    #[account(init_if_needed,payer=payer,associated_token::mint=quote_mint,associated_token::authority=allocation,associated_token::token_program=quote_token_program)]
    pub quote_account: InterfaceAccount<'info, TokenAccount>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(args: ClaimArgs)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds=[b"allocation",allocation.pool.as_ref()],bump=allocation.bump)]
    pub allocation: Account<'info, Allocation>,
    #[account(seeds=[b"ledger",allocation.key().as_ref(),mint.key().as_ref()],bump,has_one=allocation,has_one=mint)]
    pub ledger: Account<'info, Ledger>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut,associated_token::mint=mint,associated_token::authority=allocation,associated_token::token_program=token_program)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed,payer=claimant,associated_token::mint=mint,associated_token::authority=claimant,associated_token::token_program=token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed,payer=claimant,space=8+32+32+8,seeds=[b"beneficiary",args.x_id_hash.as_ref()],bump)]
    pub beneficiary: Account<'info, Beneficiary>,
    #[account(init_if_needed,payer=claimant,space=8+8,seeds=[b"claim",ledger.key().as_ref(),args.x_id_hash.as_ref()],bump)]
    pub claimed: Account<'info, Claimed>,
    #[account(init,payer=claimant,space=8+32*4+8,seeds=[b"receipt",args.nonce.as_ref()],bump)]
    pub receipt: Account<'info, Receipt>,
    /// CHECK: canonical instructions sysvar, read using checked syscall helpers.
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[account]
pub struct Config {
    pub verifier: Pubkey,
    pub bump: u8,
}
#[account]
pub struct Allocation {
    pub pool: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub launcher: Pubkey,
    pub bump: u8,
    pub shares: Vec<Share>,
}
#[account]
pub struct Ledger {
    pub allocation: Pubkey,
    pub mint: Pubkey,
    pub total_received: u64,
}
#[account]
pub struct Beneficiary {
    pub x_id_hash: [u8; 32],
    pub wallet: Pubkey,
    pub version: u64,
}
#[account]
pub struct Claimed {
    pub amount: u64,
}
#[account]
pub struct Receipt {
    pub allocation: Pubkey,
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub nonce: [u8; 32],
    pub amount: u64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Share {
    pub x_id_hash: [u8; 32],
    pub bps: u16,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClaimArgs {
    pub x_id_hash: [u8; 32],
    pub cumulative_limit: u64,
    pub binding_version: u64,
    pub nonce: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
}
#[event]
pub struct AllocationCreated {
    pub allocation: Pubkey,
    pub pool: Pubkey,
    pub shares: Vec<Share>,
}
#[event]
pub struct FeesCollected {
    pub allocation: Pubkey,
    pub venue: u8,
    pub base_amount: u64,
    pub quote_amount: u64,
}
#[event]
pub struct FeesClaimed {
    pub allocation: Pubkey,
    pub mint: Pubkey,
    pub x_id_hash: [u8; 32],
    pub wallet: Pubkey,
    pub amount: u64,
    pub nonce: [u8; 32],
}
#[error_code]
pub enum EscrowError {
    #[msg("Invalid or duplicate fee shares")]
    InvalidShares,
    #[msg("Unsupported pool or creator")]
    InvalidPool,
    #[msg("Unsupported fee venue")]
    InvalidVenue,
    #[msg("Invalid fee collection accounts")]
    InvalidCollection,
    #[msg("Recipient is not in this allocation")]
    UnknownRecipient,
    #[msg("Invalid verifier attestation")]
    InvalidAttestation,
    #[msg("Claim authorization expired or issued in the future")]
    Expired,
    #[msg("Wallet does not match the immutable X beneficiary binding")]
    InvalidBinding,
    #[msg("Nothing is currently claimable")]
    NothingToClaim,
    #[msg("Escrow balance is insufficient")]
    InsufficientVault,
    #[msg("Amount overflow")]
    Overflow,
    #[msg("Mint extensions are not supported by this escrow version")]
    UnsupportedMint,
    #[msg("Only program upgrade authority may initialize verifier configuration")]
    InvalidAuthority,
    #[msg("Invalid verifier public key")]
    InvalidVerifier,
}

#[cfg(test)]
mod tests;
