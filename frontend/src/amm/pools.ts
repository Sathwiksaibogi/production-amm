import type {
  AnchorWallet,
} from "@solana/wallet-adapter-react";

import {
  SystemProgram,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMint,
} from "@solana/spl-token";

import {
  createAmmProgram,
} from "./program";

import {
  derivePoolAddresses,
  orderMints,
  type PoolAddresses,
} from "./addresses";

import {
  fetchPoolSnapshot,
  type PoolSnapshot,
} from "./pool";

export type PoolMintValidation = {
  valid: boolean;

  token0Mint: PublicKey;
  token1Mint: PublicKey;

  token0Decimals: number;
  token1Decimals: number;

  poolExists: boolean;

  poolAddress: PublicKey;

  errors: string[];
};

export type InitializePoolResult = {
  signature: string;

  addresses:
    PoolAddresses & {
      token0Mint: PublicKey;
      token1Mint: PublicKey;
    };
};

/**
 * Validate two SPL Token v1 mints against
 * the same rules our AMM enforces.
 */
export async function validatePoolMints(
  connection: Connection,
  mintA: PublicKey,
  mintB: PublicKey
): Promise<PoolMintValidation> {
  const {
    token0Mint,
    token1Mint,
  } =
    orderMints(
      mintA,
      mintB
    );

  const addresses =
    derivePoolAddresses(
      token0Mint,
      token1Mint
    );

  const [
    token0Info,
    token1Info,
    poolInfo,
  ] =
    await Promise.all([
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

      connection.getAccountInfo(
        addresses.pool,
        "confirmed"
      ),
    ]);

  const errors: string[] = [];

  if (
    token0Info.mintAuthority !==
    null
  ) {
    errors.push(
      "Token 0 still has a mint authority."
    );
  }

  if (
    token1Info.mintAuthority !==
    null
  ) {
    errors.push(
      "Token 1 still has a mint authority."
    );
  }

  if (
    token0Info.freezeAuthority !==
    null
  ) {
    errors.push(
      "Token 0 still has a freeze authority."
    );
  }

  if (
    token1Info.freezeAuthority !==
    null
  ) {
    errors.push(
      "Token 1 still has a freeze authority."
    );
  }

  return {
    valid:
      errors.length === 0,

    token0Mint,
    token1Mint,

    token0Decimals:
      token0Info.decimals,

    token1Decimals:
      token1Info.decimals,

    poolExists:
      poolInfo !== null,

    poolAddress:
      addresses.pool,

    errors,
  };
}

/**
 * Find all Pool accounts owned by our
 * AMM program and load their live vault
 * / LP state.
 *
 * Sequential fetching is intentional:
 * public Devnet RPCs rate-limit aggressive
 * concurrent requests.
 */
export async function discoverPools(
  connection: Connection,
  wallet: AnchorWallet
): Promise<PoolSnapshot[]> {
  const program =
    createAmmProgram(
      connection,
      wallet
    );

  const poolAccounts =
    await program.account.pool.all();

  const snapshots:
    PoolSnapshot[] = [];

  for (
    const entry of poolAccounts
  ) {
    try {
      const snapshot =
        await fetchPoolSnapshot(
          connection,
          program,
          entry.publicKey
        );

      snapshots.push(
        snapshot
      );
    } catch (
      error
    ) {
      console.warn(
        "Failed to load pool:",
        entry.publicKey.toBase58(),
        error
      );
    }
  }

  snapshots.sort(
    (a, b) =>
      a.pool
        .toBase58()
        .localeCompare(
          b.pool.toBase58()
        )
  );

  return snapshots;
}

/**
 * Permissionlessly initialize one canonical
 * AMM pool for the supplied token pair.
 */
export async function initializePool(
  connection: Connection,
  wallet: AnchorWallet,
  mintA: PublicKey,
  mintB: PublicKey
): Promise<InitializePoolResult> {
  const validation =
    await validatePoolMints(
      connection,
      mintA,
      mintB
    );

  if (!validation.valid) {
    throw new Error(
      validation.errors.join(
        " "
      )
    );
  }

  const addresses =
    derivePoolAddresses(
      validation.token0Mint,
      validation.token1Mint
    );

  if (
    validation.poolExists
  ) {
    throw new Error(
      `Pool already exists at ${addresses.pool.toBase58()}.`
    );
  }

  const program =
    createAmmProgram(
      connection,
      wallet
    );

  const signature =
    await program.methods
      .initializePool()
      .accountsStrict({
        initializer:
          wallet.publicKey,

        token0Mint:
          validation.token0Mint,

        token1Mint:
          validation.token1Mint,

        pool:
          addresses.pool,

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

        systemProgram:
          SystemProgram.programId,

        tokenProgram:
          TOKEN_PROGRAM_ID,

        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

  return {
    signature,

    addresses: {
      ...addresses,

      token0Mint:
        validation.token0Mint,

      token1Mint:
        validation.token1Mint,
    },
  };
}