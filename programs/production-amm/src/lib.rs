use anchor_lang::prelude::*;

use amm_math::{calculate_initial_liquidity, calculate_liquidity_added, AmmMathError};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

declare_id!("HVyRymResYhpSjAeLfQcabBTD8s15uXVzGZJUH5HjDHC");

pub const LP_DECIMALS: u8 = 9;
pub const SWAP_FEE_BPS: u16 = 30;

#[program]
pub mod production_amm {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.token_0_mint = ctx.accounts.token_0_mint.key();
        pool.token_1_mint = ctx.accounts.token_1_mint.key();
        pool.bump = ctx.bumps.pool;

        Ok(())
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_0: u64,
        amount_1: u64,
        minimum_lp_out: u64,
    ) -> Result<()> {
        let reserve_0 = ctx.accounts.vault_0.amount;
        let reserve_1 = ctx.accounts.vault_1.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;

        let lp_to_mint = if lp_supply == 0 {
            calculate_initial_liquidity(amount_0, amount_1).map_err(map_liquidity_math_error)?
        } else {
            calculate_liquidity_added(reserve_0, reserve_1, amount_0, amount_1, lp_supply)
                .map_err(map_liquidity_math_error)?
        };
        require!(lp_to_mint >= minimum_lp_out, AmmError::MinimumLpNotMet);

        let transfer_0_accounts = anchor_spl::token::TransferChecked {
            from: ctx.accounts.user_token_0.to_account_info(),
            mint: ctx.accounts.token_0_mint.to_account_info(),
            to: ctx.accounts.vault_0.to_account_info(),
            authority: ctx.accounts.liquidity_provider.to_account_info(),
        };

        anchor_spl::token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_0_accounts,
            ),
            amount_0,
            ctx.accounts.token_0_mint.decimals,
        )?;

        let transfer_1_accounts = anchor_spl::token::TransferChecked {
            from: ctx.accounts.user_token_1.to_account_info(),
            mint: ctx.accounts.token_1_mint.to_account_info(),
            to: ctx.accounts.vault_1.to_account_info(),
            authority: ctx.accounts.liquidity_provider.to_account_info(),
        };

        anchor_spl::token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_1_accounts,
            ),
            amount_1,
            ctx.accounts.token_1_mint.decimals,
        )?;

        let token_0_key = ctx.accounts.token_0_mint.key();
        let token_1_key = ctx.accounts.token_1_mint.key();
        let pool_bump = [ctx.accounts.pool.bump];

        let pool_signer_seeds = &[
            b"pool",
            token_0_key.as_ref(),
            token_1_key.as_ref(),
            &pool_bump,
        ];

        let mint_lp_accounts = anchor_spl::token::MintTo {
            mint: ctx.accounts.lp_mint.to_account_info(),
            to: ctx.accounts.user_lp_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };

        anchor_spl::token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                mint_lp_accounts,
                &[pool_signer_seeds],
            ),
            lp_to_mint,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,

    pub token_0_mint: Account<'info, Mint>,

    #[account(
    constraint = token_0_mint.key() != token_1_mint.key() @ AmmError::IdenticalMints,
    constraint = token_0_mint.key() < token_1_mint.key() @ AmmError::NonCanonicalMintOrder,
    )]
    pub token_1_mint: Account<'info, Mint>,

    #[account(
        init,
        payer=initializer,
        space=8+Pool::INIT_SPACE,
        seeds=[b"pool",token_0_mint.key().as_ref(),token_1_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        init_if_needed,
        payer=initializer,
        associated_token::mint=token_0_mint,
        associated_token::authority=pool,
    )]
    pub vault_0: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer=initializer,
        associated_token::mint=token_1_mint,
        associated_token::authority=pool,
    )]
    pub vault_1: Account<'info, TokenAccount>,

    #[account(
        init,
        payer=initializer,
        seeds=[b"lp_mint",pool.key().as_ref()],
        bump,
        mint::decimals = LP_DECIMALS,
        mint::authority=pool,
    )]
    pub lp_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub liquidity_provider: Signer<'info>,

    pub token_0_mint: Box<Account<'info, Mint>>,

    pub token_1_mint: Box<Account<'info, Mint>>,

    #[account(
        seeds=[b"pool",token_0_mint.key().as_ref(),token_1_mint.key().as_ref()],
        bump=pool.bump,
        has_one = token_0_mint,
        has_one = token_1_mint,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        associated_token::mint=token_0_mint,
        associated_token::authority=pool,
    )]
    pub vault_0: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint=token_1_mint,
        associated_token::authority=pool,
    )]
    pub vault_1: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint=token_0_mint,
        token::authority=liquidity_provider,
    )]
    pub user_token_0: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint=token_1_mint,
        token::authority=liquidity_provider,
    )]
    pub user_token_1: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds=[b"lp_mint",pool.key().as_ref()],
        bump,
        mint::decimals = LP_DECIMALS,
        mint::authority=pool,
    )]
    pub lp_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer=liquidity_provider,
        associated_token::mint=lp_mint,
        associated_token::authority=liquidity_provider,
    )]
    pub user_lp_account: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub token_0_mint: Pubkey,
    pub token_1_mint: Pubkey,
    pub bump: u8,
}

#[error_code]
pub enum AmmError {
    #[msg("The two mints must be different")]
    IdenticalMints,
    #[msg("The two mints must be in canonical order")]
    NonCanonicalMintOrder,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Liquidity must match the current pool ratio")]
    InvalidLiquidityRatio,
    #[msg("Liquidity deposit is too small to mint LP tokens")]
    ZeroLiquidityMinted,
    #[msg("The pool is in an invalid liquidity state")]
    InvalidPoolState,
    #[msg("AMM math calculation failed")]
    MathError,
    #[msg("LP output is below the user's minimum")]
    MinimumLpNotMet,
}

fn map_liquidity_math_error(err: AmmMathError) -> anchor_lang::error::Error {
    match err {
        AmmMathError::ZeroAmount => {
            error!(AmmError::InvalidAmount)
        }

        AmmMathError::InvalidLiquidityRatio => {
            error!(AmmError::InvalidLiquidityRatio)
        }

        AmmMathError::ZeroLiquidityMinted => {
            error!(AmmError::ZeroLiquidityMinted)
        }

        AmmMathError::ZeroReserve | AmmMathError::ZeroLiquiditySupply => {
            error!(AmmError::InvalidPoolState)
        }

        AmmMathError::ArithmeticFailure => {
            error!(AmmError::MathError)
        }

        _ => {
            error!(AmmError::MathError)
        }
    }
}
