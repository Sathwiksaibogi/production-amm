import {
  BN,
} from "@coral-xyz/anchor";

import type {
  AnchorWallet,
} from "@solana/wallet-adapter-react";

import {
  SystemProgram,
  type Connection,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  createAmmProgram,
} from "./program";

import type {
  PoolSnapshot,
} from "./pool";


const U64_MAX =
  (1n << 64n) -
  1n;


function toU64Bn(
  value: bigint,
  label: string
): BN {
  if (
    value < 0n ||
    value > U64_MAX
  ) {
    throw new Error(
      `${label} does not fit into u64.`
    );
  }

  return new BN(
    value.toString()
  );
}


function userAta(
  mint: PublicKey,
  owner: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}


async function createMissingAtaInstructions(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mints: PublicKey[]
): Promise<TransactionInstruction[]> {
  const atas =
    mints.map(
      (mint) =>
        userAta(
          mint,
          owner
        )
    );

  const accountInfos =
    await connection
      .getMultipleAccountsInfo(
        atas,
        "confirmed"
      );

  const instructions:
    TransactionInstruction[] = [];

  for (
    let index = 0;
    index < atas.length;
    index++
  ) {
    if (
      accountInfos[index] === null
    ) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          atas[index],
          owner,
          mints[index],
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
  }

  return instructions;
}


export type SwapDirection =
  | "token0ToToken1"
  | "token1ToToken0";


type ExecuteSwapParams = {
  connection: Connection;

  wallet: AnchorWallet;

  pool: PoolSnapshot;

  direction: SwapDirection;

  amountIn: bigint;

  minimumAmountOut: bigint;
};


export async function executeSwap({
  connection,
  wallet,
  pool,
  direction,
  amountIn,
  minimumAmountOut,
}: ExecuteSwapParams): Promise<string> {
  if (amountIn <= 0n) {
    throw new Error(
      "Swap amount must be greater than zero."
    );
  }

  const program =
    createAmmProgram(
      connection,
      wallet
    );

  const userToken0 =
    userAta(
      pool.token0Mint,
      wallet.publicKey
    );

  const userToken1 =
    userAta(
      pool.token1Mint,
      wallet.publicKey
    );

  const ataInstructions =
    await createMissingAtaInstructions(
      connection,
      wallet.publicKey,
      wallet.publicKey,
      [
        pool.token0Mint,
        pool.token1Mint,
      ]
    );

  const swapDirection =
    direction ===
    "token0ToToken1"
      ? {
          token0ToToken1: {},
        }
      : {
          token1ToToken0: {},
        };

  return program.methods
    .swap(
      swapDirection,

      toU64Bn(
        amountIn,
        "Swap amount"
      ),

      toU64Bn(
        minimumAmountOut,
        "Minimum output"
      )
    )
    .accountsStrict({
      trader:
        wallet.publicKey,

      token0Mint:
        pool.token0Mint,

      token1Mint:
        pool.token1Mint,

      pool:
        pool.pool,

      vault0:
        pool.vault0,

      vault1:
        pool.vault1,

      userToken0,

      userToken1,

      tokenProgram:
        TOKEN_PROGRAM_ID,
    })
    .preInstructions(
      ataInstructions
    )
    .rpc();
}


type AddLiquidityParams = {
  connection: Connection;

  wallet: AnchorWallet;

  pool: PoolSnapshot;

  amount0Desired: bigint;

  amount1Desired: bigint;

  minimumAmount0: bigint;

  minimumAmount1: bigint;

  minimumLpOut: bigint;
};


export async function executeAddLiquidity({
  connection,
  wallet,
  pool,
  amount0Desired,
  amount1Desired,
  minimumAmount0,
  minimumAmount1,
  minimumLpOut,
}: AddLiquidityParams): Promise<string> {
  if (
    amount0Desired <= 0n ||
    amount1Desired <= 0n
  ) {
    throw new Error(
      "Desired liquidity amounts must be greater than zero."
    );
  }

  const program =
    createAmmProgram(
      connection,
      wallet
    );

  const userToken0 =
    userAta(
      pool.token0Mint,
      wallet.publicKey
    );

  const userToken1 =
    userAta(
      pool.token1Mint,
      wallet.publicKey
    );

  const userLpAccount =
    userAta(
      pool.lpMint,
      wallet.publicKey
    );

  return program.methods
    .addLiquidity(
      toU64Bn(
        amount0Desired,
        "Token 0 desired amount"
      ),

      toU64Bn(
        amount1Desired,
        "Token 1 desired amount"
      ),

      toU64Bn(
        minimumAmount0,
        "Minimum Token 0 amount"
      ),

      toU64Bn(
        minimumAmount1,
        "Minimum Token 1 amount"
      ),

      toU64Bn(
        minimumLpOut,
        "Minimum LP output"
      )
    )
    .accountsStrict({
      liquidityProvider:
        wallet.publicKey,

      token0Mint:
        pool.token0Mint,

      token1Mint:
        pool.token1Mint,

      pool:
        pool.pool,

      vault0:
        pool.vault0,

      vault1:
        pool.vault1,

      userToken0,

      userToken1,

      lpMint:
        pool.lpMint,

      lockAuthority:
        pool.lockAuthority,

      lockedLpAccount:
        pool.lockedLpAccount,

      userLpAccount,

      systemProgram:
        SystemProgram.programId,

      tokenProgram:
        TOKEN_PROGRAM_ID,

      associatedTokenProgram:
        ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
}


type RemoveLiquidityParams = {
  connection: Connection;

  wallet: AnchorWallet;

  pool: PoolSnapshot;

  lpToBurn: bigint;

  minimumAmount0Out: bigint;

  minimumAmount1Out: bigint;
};


export async function executeRemoveLiquidity({
  connection,
  wallet,
  pool,
  lpToBurn,
  minimumAmount0Out,
  minimumAmount1Out,
}: RemoveLiquidityParams): Promise<string> {
  if (lpToBurn <= 0n) {
    throw new Error(
      "LP burn amount must be greater than zero."
    );
  }

  const program =
    createAmmProgram(
      connection,
      wallet
    );

  const userToken0 =
    userAta(
      pool.token0Mint,
      wallet.publicKey
    );

  const userToken1 =
    userAta(
      pool.token1Mint,
      wallet.publicKey
    );

  const userLpAccount =
    userAta(
      pool.lpMint,
      wallet.publicKey
    );

  const ataInstructions =
    await createMissingAtaInstructions(
      connection,
      wallet.publicKey,
      wallet.publicKey,
      [
        pool.token0Mint,
        pool.token1Mint,
      ]
    );

  return program.methods
    .removeLiquidity(
      toU64Bn(
        lpToBurn,
        "LP burn amount"
      ),

      toU64Bn(
        minimumAmount0Out,
        "Minimum Token 0 output"
      ),

      toU64Bn(
        minimumAmount1Out,
        "Minimum Token 1 output"
      )
    )
    .accountsStrict({
      liquidityProvider:
        wallet.publicKey,

      token0Mint:
        pool.token0Mint,

      token1Mint:
        pool.token1Mint,

      pool:
        pool.pool,

      vault0:
        pool.vault0,

      vault1:
        pool.vault1,

      userToken0,

      userToken1,

      lpMint:
        pool.lpMint,

      userLpAccount,

      tokenProgram:
        TOKEN_PROGRAM_ID,
    })
    .preInstructions(
      ataInstructions
    )
    .rpc();
}