import {
  PublicKey,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  PROGRAM_ID,
} from "../config/solana";

const encoder =
  new TextEncoder();

const POOL_SEED =
  encoder.encode("pool");

const LP_MINT_SEED =
  encoder.encode("lp_mint");

const LOCK_AUTHORITY_SEED =
  encoder.encode(
    "lock_authority"
  );

export type CanonicalMints = {
  token0Mint: PublicKey;
  token1Mint: PublicKey;
};

export type PoolAddresses = {
  pool: PublicKey;
  poolBump: number;

  vault0: PublicKey;
  vault1: PublicKey;

  lpMint: PublicKey;
  lpMintBump: number;

  lockAuthority: PublicKey;
  lockAuthorityBump: number;

  lockedLpAccount: PublicKey;
};

function comparePublicKeys(
  a: PublicKey,
  b: PublicKey
): number {
  const aBytes = a.toBytes();
  const bBytes = b.toBytes();

  for (
    let index = 0;
    index < aBytes.length;
    index++
  ) {
    if (
      aBytes[index] <
      bBytes[index]
    ) {
      return -1;
    }

    if (
      aBytes[index] >
      bBytes[index]
    ) {
      return 1;
    }
  }

  return 0;
}

export function orderMints(
  mintA: PublicKey,
  mintB: PublicKey
): CanonicalMints {
  if (mintA.equals(mintB)) {
    throw new Error(
      "Pool token mints must be different."
    );
  }

  if (
    comparePublicKeys(
      mintA,
      mintB
    ) < 0
  ) {
    return {
      token0Mint: mintA,
      token1Mint: mintB,
    };
  }

  return {
    token0Mint: mintB,
    token1Mint: mintA,
  };
}

export function derivePoolAddress(
  token0Mint: PublicKey,
  token1Mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      POOL_SEED,
      token0Mint.toBytes(),
      token1Mint.toBytes(),
    ],
    PROGRAM_ID
  );
}

export function derivePoolAddresses(
  mintA: PublicKey,
  mintB: PublicKey
): PoolAddresses &
  CanonicalMints {
  const {
    token0Mint,
    token1Mint,
  } = orderMints(
    mintA,
    mintB
  );

  const [
    pool,
    poolBump,
  ] =
    derivePoolAddress(
      token0Mint,
      token1Mint
    );

  const [
    lpMint,
    lpMintBump,
  ] =
    PublicKey.findProgramAddressSync(
      [
        LP_MINT_SEED,
        pool.toBytes(),
      ],
      PROGRAM_ID
    );

  const [
    lockAuthority,
    lockAuthorityBump,
  ] =
    PublicKey.findProgramAddressSync(
      [
        LOCK_AUTHORITY_SEED,
        pool.toBytes(),
      ],
      PROGRAM_ID
    );

  const vault0 =
    getAssociatedTokenAddressSync(
      token0Mint,
      pool,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

  const vault1 =
    getAssociatedTokenAddressSync(
      token1Mint,
      pool,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

  const lockedLpAccount =
    getAssociatedTokenAddressSync(
      lpMint,
      lockAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

  return {
    token0Mint,
    token1Mint,

    pool,
    poolBump,

    vault0,
    vault1,

    lpMint,
    lpMintBump,

    lockAuthority,
    lockAuthorityBump,

    lockedLpAccount,
  };
}