import {
  type Program,
} from "@coral-xyz/anchor";

import {
  PublicKey,
  type Connection,
} from "@solana/web3.js";

import {
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import type {
  ProductionAmm,
} from "../idl/production_amm";

import {
  derivePoolAddresses,
} from "./addresses";

export type PoolSnapshot = {
  pool: PublicKey;

  token0Mint: PublicKey;
  token1Mint: PublicKey;

  vault0: PublicKey;
  vault1: PublicKey;

  lpMint: PublicKey;

  lockAuthority: PublicKey;
  lockedLpAccount: PublicKey;

  reserve0: bigint;
  reserve1: bigint;

  lpSupply: bigint;
  lockedLpAmount: bigint;

  token0Decimals: number;
  token1Decimals: number;
  lpDecimals: number;

  bump: number;
};

export async function fetchPoolSnapshot(
  connection: Connection,
  program: Program<ProductionAmm>,
  poolAddress: PublicKey
): Promise<PoolSnapshot> {
  const poolAccount =
    await program.account.pool.fetch(
      poolAddress
    );

  const token0Mint =
    poolAccount.token0Mint;

  const token1Mint =
    poolAccount.token1Mint;

  const addresses =
    derivePoolAddresses(
      token0Mint,
      token1Mint
    );

  if (
    !addresses.pool.equals(
      poolAddress
    )
  ) {
    throw new Error(
      "Pool account does not match its canonical PDA."
    );
  }

  const [
    vault0,
    vault1,
    lpMint,
    lockedLpAccount,
    token0MintInfo,
    token1MintInfo,
  ] =
    await Promise.all([
      getAccount(
        connection,
        addresses.vault0,
        "confirmed",
        TOKEN_PROGRAM_ID
      ),

      getAccount(
        connection,
        addresses.vault1,
        "confirmed",
        TOKEN_PROGRAM_ID
      ),

      getMint(
        connection,
        addresses.lpMint,
        "confirmed",
        TOKEN_PROGRAM_ID
      ),

      getAccount(
        connection,
        addresses.lockedLpAccount,
        "confirmed",
        TOKEN_PROGRAM_ID
      ),

      getMint(
        connection,
        token0Mint,
        "confirmed",
        TOKEN_PROGRAM_ID
      ),

      getMint(
        connection,
        token1Mint,
        "confirmed",
        TOKEN_PROGRAM_ID
      ),
    ]);

  return {
    pool: poolAddress,

    token0Mint,
    token1Mint,

    vault0:
      addresses.vault0,

    vault1:
      addresses.vault1,

    lpMint:
      addresses.lpMint,

    lockAuthority:
      addresses.lockAuthority,

    lockedLpAccount:
      addresses.lockedLpAccount,

    reserve0:
      vault0.amount,

    reserve1:
      vault1.amount,

    lpSupply:
      lpMint.supply,

    lockedLpAmount:
      lockedLpAccount.amount,

    token0Decimals:
      token0MintInfo.decimals,

    token1Decimals:
      token1MintInfo.decimals,

    lpDecimals:
      lpMint.decimals,

    bump:
      poolAccount.bump,
  };
}