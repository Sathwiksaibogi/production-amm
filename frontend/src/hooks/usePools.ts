import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  useAnchorWallet,
  useConnection,
} from "@solana/wallet-adapter-react";

import {
  discoverPools,
} from "../amm/pools";

import type {
  PoolSnapshot,
} from "../amm/pool";

export function usePools() {
  const {
    connection,
  } =
    useConnection();

  const wallet =
    useAnchorWallet();

  const [
    pools,
    setPools,
  ] =
    useState<
      PoolSnapshot[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const refresh =
    useCallback(
      async () => {
        if (!wallet) {
          setPools([]);
          setError(null);
          return;
        }

        setLoading(true);
        setError(null);

        try {
          const foundPools =
            await discoverPools(
              connection,
              wallet
            );

          setPools(
            foundPools
          );
        } catch (
          caughtError
        ) {
          console.error(
            caughtError
          );

          setError(
            caughtError
              instanceof Error
              ? caughtError.message
              : "Failed to discover pools."
          );
        } finally {
          setLoading(false);
        }
      },
      [
        connection,
        wallet,
      ]
    );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    pools,
    loading,
    error,
    refresh,
  };
}