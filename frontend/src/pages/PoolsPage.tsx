import {
  useMemo,
  useState,
} from "react";

import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";

import {
  useWalletModal,
} from "@solana/wallet-adapter-react-ui";

import {
  PublicKey,
} from "@solana/web3.js";

import {
  derivePoolAddresses,
} from "../amm/addresses";

import {
  initializePool,
  validatePoolMints,
} from "../amm/pools";

import {
  formatTokenAmount,
  shortenAddress,
} from "../amm/amounts";

import {
  usePools,
} from "../hooks/usePools";

import {
  explorerAddressUrl,
} from "../config/solana";

type PoolsPageProps = {
  activePool: string;

  onSelectPool: (
    pool: string
  ) => void;
};

type ValidationState = {
  type:
    | "idle"
    | "valid"
    | "invalid";

  message: string;
};

export function PoolsPage({
  activePool,
  onSelectPool,
}: PoolsPageProps) {
  const {
    connection,
  } =
    useConnection();

  const {
    connected,
  } =
    useWallet();

  const wallet =
    useAnchorWallet();

  const {
    setVisible,
  } =
    useWalletModal();

  const {
    pools,
    loading,
    error,
    refresh,
  } =
    usePools();

  const [
    mintA,
    setMintA,
  ] =
    useState("");

  const [
    mintB,
    setMintB,
  ] =
    useState("");

  const [
    validation,
    setValidation,
  ] =
    useState<ValidationState>({
      type: "idle",
      message: "",
    });

  const [
    creating,
    setCreating,
  ] =
    useState(false);

  const [
    success,
    setSuccess,
  ] =
    useState<
      string | null
    >(null);

  const derived =
    useMemo(() => {
      try {
        if (
          !mintA.trim() ||
          !mintB.trim()
        ) {
          return null;
        }

        return derivePoolAddresses(
          new PublicKey(
            mintA.trim()
          ),
          new PublicKey(
            mintB.trim()
          )
        );
      } catch {
        return null;
      }
    }, [
      mintA,
      mintB,
    ]);

  async function checkMints() {
    setSuccess(null);

    try {
      const mintAPublicKey =
        new PublicKey(
          mintA.trim()
        );

      const mintBPublicKey =
        new PublicKey(
          mintB.trim()
        );

      const result =
        await validatePoolMints(
          connection,
          mintAPublicKey,
          mintBPublicKey
        );

      if (!result.valid) {
        setValidation({
          type: "invalid",

          message:
            result.errors.join(
              " "
            ),
        });

        return;
      }

      if (
        result.poolExists
      ) {
        setValidation({
          type: "valid",

          message:
            "These mints are valid, but the canonical pool already exists.",
        });

        onSelectPool(
          result.poolAddress.toBase58()
        );

        return;
      }

      setValidation({
        type: "valid",

        message:
          "Token mints are valid and the canonical pool is available for creation.",
      });
    } catch (
      caughtError
    ) {
      setValidation({
        type: "invalid",

        message:
          caughtError
            instanceof Error
            ? caughtError.message
            : "Unable to validate the supplied mints.",
      });
    }
  }

  async function createPool() {
    if (!wallet) {
      setVisible(true);
      return;
    }

    setCreating(true);
    setSuccess(null);

    try {
      const mintAPublicKey =
        new PublicKey(
          mintA.trim()
        );

      const mintBPublicKey =
        new PublicKey(
          mintB.trim()
        );

      const result =
        await initializePool(
          connection,
          wallet,
          mintAPublicKey,
          mintBPublicKey
        );

      const newPool =
        result.addresses.pool
          .toBase58();

      onSelectPool(
        newPool
      );

      setValidation({
        type: "valid",

        message:
          "Pool created successfully. It is now the active pool.",
      });

      setSuccess(
        result.signature
      );

      await refresh();
    } catch (
      caughtError
    ) {
      console.error(
        caughtError
      );

      setValidation({
        type: "invalid",

        message:
          caughtError
            instanceof Error
            ? caughtError.message
            : "Pool initialization failed.",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="pools-panel">
      <div className="panel-header">
        <div>
          <div className="section-label">
            POOLS
          </div>

          <h2>
            Pool registry
          </h2>
        </div>

        <button
          className="settings-button"
          type="button"
          onClick={() =>
            void refresh()
          }
          title="Refresh pools"
        >
          ↻
        </button>
      </div>

      <div className="pool-create-card">
        <div className="pool-section-title">
          Create canonical pool
        </div>

        <p className="pool-help">
          Enter two legacy SPL Token
          mint addresses. The frontend
          will sort them canonically,
          derive the Pool PDA and check
          whether the pool already
          exists.
        </p>

        <label className="pool-input-label">
          Token A mint
        </label>

        <input
          className="pool-address-input"
          value={mintA}
          onChange={(event) => {
            setMintA(
              event.target.value
            );

            setValidation({
              type: "idle",
              message: "",
            });
          }}
          placeholder="SPL token mint address"
        />

        <label className="pool-input-label">
          Token B mint
        </label>

        <input
          className="pool-address-input"
          value={mintB}
          onChange={(event) => {
            setMintB(
              event.target.value
            );

            setValidation({
              type: "idle",
              message: "",
            });
          }}
          placeholder="SPL token mint address"
        />

        {derived && (
          <div className="derived-pool">
            <span>
              Canonical Pool PDA
            </span>

            <strong
              title={
                derived.pool
                  .toBase58()
              }
            >
              {shortenAddress(
                derived.pool
                  .toBase58(),
                7
              )}
            </strong>
          </div>
        )}

        {validation.message && (
          <div
            className={
              validation.type ===
              "invalid"
                ? "pool-message error"
                : "pool-message success"
            }
          >
            {validation.message}
          </div>
        )}

        {success && (
          <a
            className="pool-transaction-link"
            href={
              `https://explorer.solana.com/tx/` +
              `${success}?cluster=devnet`
            }
            target="_blank"
            rel="noreferrer"
          >
            View initialization
            transaction ↗
          </a>
        )}

        <div className="pool-create-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={
              !derived ||
              creating
            }
            onClick={() =>
              void checkMints()
            }
          >
            Validate mints
          </button>

          {!connected ? (
            <button
              className="primary-button pool-create-button"
              type="button"
              onClick={() =>
                setVisible(true)
              }
            >
              Connect wallet
            </button>
          ) : (
            <button
              className="primary-button pool-create-button"
              type="button"
              disabled={
                !derived ||
                creating
              }
              onClick={() =>
                void createPool()
              }
            >
              {creating
                ? "Creating pool..."
                : "Create pool"}
            </button>
          )}
        </div>
      </div>

      <div className="existing-pools-header">
        <div>
          <div className="pool-section-title">
            Existing pools
          </div>

          <span>
            {loading
              ? "Discovering..."
              : `${pools.length} discovered`}
          </span>
        </div>
      </div>

      {error && (
        <div className="pool-message error">
          {error}
        </div>
      )}

      {!connected && (
        <div className="empty-pools">
          Connect your wallet to
          discover Devnet pools.
        </div>
      )}

      {connected &&
        !loading &&
        pools.length === 0 && (
          <div className="empty-pools">
            No pools have been
            discovered yet.
          </div>
        )}

      <div className="pool-list">
        {pools.map(
          (pool) => {
            const address =
              pool.pool
                .toBase58();

            const selected =
              address ===
              activePool;

            return (
              <article
                className={
                  selected
                    ? "pool-card selected"
                    : "pool-card"
                }
                key={address}
              >
                <div className="pool-card-top">
                  <div>
                    <span>
                      Pool
                    </span>

                    <a
                      href={
                        explorerAddressUrl(
                          address
                        )
                      }
                      target="_blank"
                      rel="noreferrer"
                      title={address}
                    >
                      {shortenAddress(
                        address,
                        6
                      )}
                      ↗
                    </a>
                  </div>

                  {selected && (
                    <div className="active-pool-badge">
                      Active
                    </div>
                  )}
                </div>

                <div className="pool-token-pair">
                  <div>
                    <small>
                      Token 0
                    </small>

                    <strong
                      title={
                        pool.token0Mint
                          .toBase58()
                      }
                    >
                      {shortenAddress(
                        pool.token0Mint
                          .toBase58(),
                        5
                      )}
                    </strong>
                  </div>

                  <span>
                    /
                  </span>

                  <div>
                    <small>
                      Token 1
                    </small>

                    <strong
                      title={
                        pool.token1Mint
                          .toBase58()
                      }
                    >
                      {shortenAddress(
                        pool.token1Mint
                          .toBase58(),
                        5
                      )}
                    </strong>
                  </div>
                </div>

                <div className="pool-stats">
                  <div>
                    <span>
                      Reserve 0
                    </span>

                    <strong>
                      {formatTokenAmount(
                        pool.reserve0,
                        pool.token0Decimals
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Reserve 1
                    </span>

                    <strong>
                      {formatTokenAmount(
                        pool.reserve1,
                        pool.token1Decimals
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      LP supply
                    </span>

                    <strong>
                      {formatTokenAmount(
                        pool.lpSupply,
                        pool.lpDecimals
                      )}
                    </strong>
                  </div>
                </div>

                <button
                  className={
                    selected
                      ? "secondary-button selected-pool-button"
                      : "secondary-button"
                  }
                  type="button"
                  disabled={
                    selected
                  }
                  onClick={() =>
                    onSelectPool(
                      address
                    )
                  }
                >
                  {selected
                    ? "Active pool"
                    : "Use this pool"}
                </button>
              </article>
            );
          }
        )}
      </div>
    </div>
  );
}