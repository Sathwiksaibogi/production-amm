import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";

import {
  PublicKey,
} from "@solana/web3.js";

import {
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

export type WalletTokenBalances = {
  token0: bigint;
  token1: bigint;
  lp: bigint;
};

const EMPTY_BALANCES:
  WalletTokenBalances = {
    token0: 0n,
    token1: 0n,
    lp: 0n,
  };

async function readTokenBalance(
  connection:
    ReturnType<
      typeof useConnection
    >["connection"],

  tokenAccount:
    PublicKey
): Promise<bigint> {
  try {
    const response =
      await connection
        .getTokenAccountBalance(
          tokenAccount,
          "confirmed"
        );

    return BigInt(
      response.value.amount
    );
  } catch {
    return 0n;
  }
}

export function useTokenBalances(
  token0Mint:
    | PublicKey
    | null,

  token1Mint:
    | PublicKey
    | null,

  lpMint:
    | PublicKey
    | null
) {
  const {
    connection,
  } = useConnection();

  const {
    publicKey,
  } = useWallet();

  const [
    balances,
    setBalances,
  ] =
    useState<WalletTokenBalances>(
      EMPTY_BALANCES
    );

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const refresh =
    useCallback(
      async () => {
        if (
          !publicKey ||
          !token0Mint ||
          !token1Mint ||
          !lpMint
        ) {
          setBalances(
            EMPTY_BALANCES
          );

          return;
        }

        setLoading(true);

        try {
          const token0Account =
            getAssociatedTokenAddressSync(
              token0Mint,
              publicKey
            );

          const token1Account =
            getAssociatedTokenAddressSync(
              token1Mint,
              publicKey
            );

          const lpAccount =
            getAssociatedTokenAddressSync(
              lpMint,
              publicKey
            );

          const [
            token0,
            token1,
            lp,
          ] =
            await Promise.all([
              readTokenBalance(
                connection,
                token0Account
              ),

              readTokenBalance(
                connection,
                token1Account
              ),

              readTokenBalance(
                connection,
                lpAccount
              ),
            ]);

          setBalances({
            token0,
            token1,
            lp,
          });
        } finally {
          setLoading(false);
        }
      },
      [
        connection,
        publicKey,
        token0Mint,
        token1Mint,
        lpMint,
      ]
    );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    balances,
    loading,
    refresh,
  };
}