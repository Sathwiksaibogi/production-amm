use anchor_lang::prelude::*;

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
}
