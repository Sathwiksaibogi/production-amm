import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useAnchorWallet,
  useConnection,
} from "@solana/wallet-adapter-react";

import {
  PublicKey,
} from "@solana/web3.js";

import {
  createAmmProgram,
} from "../amm/program";

import {
  fetchPoolSnapshot,
  type PoolSnapshot,
} from "../amm/pool";

type UsePoolResult = {
  pool:
    | PoolSnapshot
    | null;

  loading: boolean;

  error:
    | string
    | null;

  refresh: () =>
    Promise<void>;
};

export function usePool(
  poolAddress:
    | string
    | undefined
): UsePoolResult {
  const {
    connection,
  } = useConnection();

  const wallet =
    useAnchorWallet();

  const [
    pool,
    setPool,
  ] =
    useState<
      PoolSnapshot | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const parsedPoolAddress =
    useMemo(() => {
      if (!poolAddress) {
        return null;
      }

      try {
        return new PublicKey(
          poolAddress
        );
      } catch {
        return null;
      }
    }, [poolAddress]);

  const refresh =
    useCallback(
      async () => {
        if (
          !wallet ||
          !parsedPoolAddress
        ) {
          setPool(null);
          return;
        }

        setLoading(true);
        setError(null);

        try {
          const program =
            createAmmProgram(
              connection,
              wallet
            );

          const snapshot =
            await fetchPoolSnapshot(
              connection,
              program,
              parsedPoolAddress
            );

          setPool(snapshot);
        } catch (
          caughtError
        ) {
          console.error(
            caughtError
          );

          setPool(null);

          setError(
            caughtError
              instanceof Error
              ? caughtError.message
              : "Failed to load pool."
          );
        } finally {
          setLoading(false);
        }
      },
      [
        connection,
        wallet,
        parsedPoolAddress,
      ]
    );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    pool,
    loading,
    error,
    refresh,
  };
}