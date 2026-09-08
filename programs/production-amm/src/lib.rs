use anchor_lang::prelude::*;

use amm_math::{
    calculate_initial_liquidity, calculate_liquidity_added, calculate_liquidity_withdrawal,
    calculate_swap_output, AmmMathError,
};
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

    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_to_burn: u64,
        minimum_amount_0_out: u64,
        minimum_amount_1_out: u64,
    ) -> Result<()> {
        let reserve_0 = ctx.accounts.vault_0.amount;
        let reserve_1 = ctx.accounts.vault_1.amount;
        let lp_supply = ctx.accounts.lp_mint.supply;

        require!(
            lp_to_burn <= ctx.accounts.user_lp_account.amount,
            AmmError::InsufficientLpBalance
        );

        let withdrawal =
            calculate_liquidity_withdrawal(reserve_0, reserve_1, lp_supply, lp_to_burn)
                .map_err(map_withdrawal_math_error)?;

        let amount_0_out = withdrawal.amount_a;
        let amount_1_out = withdrawal.amount_b;

        require!(
            amount_0_out >= minimum_amount_0_out,
            AmmError::MinimumAmount0NotMet
        );

        require!(
            amount_1_out >= minimum_amount_1_out,
            AmmError::MinimumAmount1NotMet
        );

        let burn_lp_accounts = anchor_spl::token::Burn {
            mint: ctx.accounts.lp_mint.to_account_info(),
            from: ctx.accounts.user_lp_account.to_account_info(),
            authority: ctx.accounts.liquidity_provider.to_account_info(),
        };

        anchor_spl::token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                burn_lp_accounts,
            ),
            lp_to_burn,
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

        let transfer_0_accounts = anchor_spl::token::TransferChecked {
            from: ctx.accounts.vault_0.to_account_info(),
            mint: ctx.accounts.token_0_mint.to_account_info(),
            to: ctx.accounts.user_token_0.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };

        anchor_spl::token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_0_accounts,
                &[pool_signer_seeds],
            ),
            amount_0_out,
            ctx.accounts.token_0_mint.decimals,
        )?;

        let transfer_1_accounts = anchor_spl::token::TransferChecked {
            from: ctx.accounts.vault_1.to_account_info(),
            mint: ctx.accounts.token_1_mint.to_account_info(),
            to: ctx.accounts.user_token_1.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };

        anchor_spl::token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_1_accounts,
                &[pool_signer_seeds],
            ),
            amount_1_out,
            ctx.accounts.token_1_mint.decimals,
        )?;

        Ok(())
    }

    pub fn swap(
        ctx: Context<Swap>,
        direction: SwapDirection,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        let (reserve_in, reserve_out) = match direction {
            SwapDirection::Token0ToToken1 => {
                (ctx.accounts.vault_0.amount, ctx.accounts.vault_1.amount)
            }
            SwapDirection::Token1ToToken0 => {
                (ctx.accounts.vault_1.amount, ctx.accounts.vault_0.amount)
            }
        };

        let swap_result = calculate_swap_output(reserve_in, reserve_out, amount_in, SWAP_FEE_BPS)
            .map_err(map_swap_math_error)?;
        let amount_out = swap_result.amount_out;

        require!(
            amount_out >= minimum_amount_out,
            AmmError::MinimumAmountOutNotMet
        );

        let (
            user_input,
            input_mint,
            input_vault,
            output_vault,
            output_mint,
            user_output,
            input_decimals,
            output_decimals,
        ) = match direction {
            SwapDirection::Token0ToToken1 => (
                ctx.accounts.user_token_0.to_account_info(),
                ctx.accounts.token_0_mint.to_account_info(),
                ctx.accounts.vault_0.to_account_info(),
                ctx.accounts.vault_1.to_account_info(),
                ctx.accounts.token_1_mint.to_account_info(),
                ctx.accounts.user_token_1.to_account_info(),
                ctx.accounts.token_0_mint.decimals,
                ctx.accounts.token_1_mint.decimals,
            ),
            SwapDirection::Token1ToToken0 => (
                ctx.accounts.user_token_1.to_account_info(),
                ctx.accounts.token_1_mint.to_account_info(),
                ctx.accounts.vault_1.to_account_info(),
                ctx.accounts.vault_0.to_account_info(),
                ctx.accounts.token_0_mint.to_account_info(),
                ctx.accounts.user_token_0.to_account_info(),
                ctx.accounts.token_1_mint.decimals,
                ctx.accounts.token_0_mint.decimals,
            ),
        };

        let trader_transfer_accounts = anchor_spl::token::TransferChecked {
            from: user_input,
            mint: input_mint,
            to: input_vault,
            authority: ctx.accounts.trader.to_account_info(),
        };

        anchor_spl::token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                trader_transfer_accounts,
            ),
            amount_in,
            input_decimals,
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

        let pool_transfer_accounts = anchor_spl::token::TransferChecked {
            from: output_vault,
            mint: output_mint,
            to: user_output,
            authority: ctx.accounts.pool.to_account_info(),
        };

        anchor_spl::token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                pool_transfer_accounts,
                &[pool_signer_seeds],
            ),
            amount_out,
            output_decimals,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,

    #[account(
        constraint=token_0_mint.freeze_authority.is_none() @ AmmError::FreezeAuthorityNotAllowed,
        constraint = token_0_mint.mint_authority.is_none() @ AmmError::MintAuthorityNotAllowed,
    )]
    pub token_0_mint: Account<'info, Mint>,

    #[account(
    constraint = token_0_mint.key() != token_1_mint.key() @ AmmError::IdenticalMints,
    constraint = token_0_mint.key() < token_1_mint.key() @ AmmError::NonCanonicalMintOrder,
    constraint=token_1_mint.freeze_authority.is_none() @ AmmError::FreezeAuthorityNotAllowed,
    constraint = token_1_mint.mint_authority.is_none() @ AmmError::MintAuthorityNotAllowed,
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

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
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
        mut,
        token::mint=lp_mint,
        token::authority=liquidity_provider,
    )]
    pub user_lp_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    pub trader: Signer<'info>,

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
        token::authority=trader,
    )]
    pub user_token_0: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint=token_1_mint,
        token::authority=trader,
    )]
    pub user_token_1: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub token_0_mint: Pubkey,
    pub token_1_mint: Pubkey,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SwapDirection {
    Token0ToToken1,
    Token1ToToken0,
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
    #[msg("LP burn amount exceeds the total LP supply")]
    LiquidityBurnExceedsSupply,
    #[msg("LP burn amount is too small to withdraw both assets")]
    ZeroWithdrawalAmount,
    #[msg("Token 0 output is below the user's minimum")]
    MinimumAmount0NotMet,
    #[msg("Token 1 output is below the user's minimum")]
    MinimumAmount1NotMet,
    #[msg("Liquidity provider does not have enough LP tokens")]
    InsufficientLpBalance,
    #[msg("Swap output is below the user's minimum")]
    MinimumAmountOutNotMet,
    #[msg("Swap output is zero")]
    ZeroSwapOutput,
    #[msg("Token mint must not have a freeze authority")]
    FreezeAuthorityNotAllowed,
    #[msg("Token mint must not have a mint authority")]
    MintAuthorityNotAllowed,
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

fn map_withdrawal_math_error(err: AmmMathError) -> anchor_lang::error::Error {
    match err {
        AmmMathError::ZeroAmount => {
            error!(AmmError::InvalidAmount)
        }

        AmmMathError::ZeroReserve | AmmMathError::ZeroLiquiditySupply => {
            error!(AmmError::InvalidPoolState)
        }

        AmmMathError::LiquidityBurnExceedsSupply => {
            error!(AmmError::LiquidityBurnExceedsSupply)
        }

        AmmMathError::ZeroWithdrawalAmount => {
            error!(AmmError::ZeroWithdrawalAmount)
        }

        AmmMathError::ArithmeticFailure => {
            error!(AmmError::MathError)
        }

        _ => {
            error!(AmmError::MathError)
        }
    }
}
fn map_swap_math_error(err: AmmMathError) -> anchor_lang::error::Error {
    match err {
        AmmMathError::ZeroAmount => {
            error!(AmmError::InvalidAmount)
        }

        AmmMathError::ZeroReserve => {
            error!(AmmError::InvalidPoolState)
        }

        AmmMathError::ZeroOutput => {
            error!(AmmError::ZeroSwapOutput)
        }

        AmmMathError::ArithmeticFailure | AmmMathError::InvalidFee => {
            error!(AmmError::MathError)
        }

        _ => {
            error!(AmmError::MathError)
        }
    }
}
