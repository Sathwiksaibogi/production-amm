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
  TokenField,
} from "../components/TokenField";

import {
  usePool,
} from "../hooks/usePool";

import {
  useTokenBalances,
} from "../hooks/useTokenBalances";

import {
  formatBps,
  formatTokenAmount,
  parseTokenAmount,
  shortenAddress,
} from "../amm/amounts";

import {
  quoteExactInput,
} from "../amm/quote";

import {
  executeSwap,
} from "../amm/transactions";

import {
  explorerTransactionUrl,
} from "../config/solana";


type SwapPageProps = {
  poolAddress: string;
};


export function SwapPage({
  poolAddress,
}: SwapPageProps) {
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
    pool,
    loading,
    error,
    refresh,
  } =
    usePool(
      poolAddress
    );


  const {
    balances,
    loading:
      balancesLoading,
    refresh:
      refreshBalances,
  } =
    useTokenBalances(
      pool?.token0Mint ??
        null,

      pool?.token1Mint ??
        null,

      pool?.lpMint ??
        null
    );


  const [
    direction,
    setDirection,
  ] =
    useState<
      | "token0ToToken1"
      | "token1ToToken0"
    >(
      "token0ToToken1"
    );


  const [
    amountIn,
    setAmountIn,
  ] =
    useState("");


  const [
    slippageBps,
  ] =
    useState(50n);


  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);


  const [
    transactionSignature,
    setTransactionSignature,
  ] =
    useState<
      string | null
    >(null);


  const [
    transactionError,
    setTransactionError,
  ] =
    useState<
      string | null
    >(null);


  const token0ToToken1 =
    direction ===
    "token0ToToken1";


  const inputDecimals =
    pool
      ? token0ToToken1
        ? pool.token0Decimals
        : pool.token1Decimals
      : 0;


  const outputDecimals =
    pool
      ? token0ToToken1
        ? pool.token1Decimals
        : pool.token0Decimals
      : 0;


  const reserveIn =
    pool
      ? token0ToToken1
        ? pool.reserve0
        : pool.reserve1
      : 0n;


  const reserveOut =
    pool
      ? token0ToToken1
        ? pool.reserve1
        : pool.reserve0
      : 0n;


  const inputBalance =
    token0ToToken1
      ? balances.token0
      : balances.token1;


  const outputBalance =
    token0ToToken1
      ? balances.token1
      : balances.token0;


  const fromToken =
    token0ToToken1
      ? "Token 0"
      : "Token 1";


  const toToken =
    token0ToToken1
      ? "Token 1"
      : "Token 0";


  const amountInRaw =
    useMemo(() => {
      if (
        !pool ||
        !amountIn
      ) {
        return 0n;
      }

      try {
        return parseTokenAmount(
          amountIn,
          inputDecimals
        );
      } catch {
        return 0n;
      }
    }, [
      amountIn,
      pool,
      inputDecimals,
    ]);


  const quote =
    useMemo(() => {
      if (
        !pool ||
        amountInRaw <= 0n
      ) {
        return null;
      }

      try {
        return quoteExactInput(
          reserveIn,
          reserveOut,
          amountInRaw,
          slippageBps
        );
      } catch {
        return null;
      }
    }, [
      pool,
      reserveIn,
      reserveOut,
      amountInRaw,
      slippageBps,
    ]);


  const amountOutDisplay =
    quote
      ? formatTokenAmount(
          quote.amountOut,
          outputDecimals
        )
      : "";


  function reverseDirection() {
    setDirection(
      token0ToToken1
        ? "token1ToToken0"
        : "token0ToToken1"
    );

    setAmountIn("");

    setTransactionSignature(
      null
    );

    setTransactionError(
      null
    );
  }


  async function refreshAll() {
    await Promise.all([
      refresh(),
      refreshBalances(),
    ]);
  }


  async function handleSwap() {
    if (
      !wallet ||
      !pool ||
      !quote
    ) {
      return;
    }

    setSubmitting(true);

    setTransactionError(
      null
    );

    setTransactionSignature(
      null
    );

    try {
      const signature =
        await executeSwap({
          connection,

          wallet,

          pool,

          direction,

          amountIn:
            amountInRaw,

          minimumAmountOut:
            quote.minimumOut,
        });

      setTransactionSignature(
        signature
      );

      setAmountIn("");

      await refreshAll();
    } catch (
      caughtError
    ) {
      console.error(
        caughtError
      );

      setTransactionError(
        caughtError
          instanceof Error
          ? caughtError.message
          : "Swap transaction failed."
      );
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div className="trade-panel">

      <div className="panel-header">
        <div>
          <div className="section-label">
            TRADE
          </div>

          <h2>
            Swap tokens
          </h2>
        </div>

        <button
          className="settings-button"
          type="button"
          onClick={() =>
            void refreshAll()
          }
          title="Refresh pool"
        >
          ↻
        </button>
      </div>


      {loading && (
        <div className="info-message">
          <span>i</span>

          Loading selected pool
          from Devnet...
        </div>
      )}


      {error && (
        <div className="pool-message error">
          {error}
        </div>
      )}


      {pool && (
        <div className="info-message">
          <span>✓</span>

          Pool{" "}

          {shortenAddress(
            pool.pool.toBase58()
          )}

          {" · "}

          LP supply{" "}

          {formatTokenAmount(
            pool.lpSupply,
            pool.lpDecimals
          )}
        </div>
      )}


      <TokenField
        label="You pay"
        token={fromToken}
        value={amountIn}
        onChange={
          setAmountIn
        }
        balance={
          pool
            ? formatTokenAmount(
                inputBalance,
                inputDecimals
              )
            : "—"
        }
      />


      <div className="reverse-container">
        <button
          className="reverse-button"
          type="button"
          onClick={
            reverseDirection
          }
        >
          ↓↑
        </button>
      </div>


      <TokenField
        label="You receive"
        token={toToken}
        value={
          amountOutDisplay
        }
        onChange={() => {}}
        balance={
          pool
            ? formatTokenAmount(
                outputBalance,
                outputDecimals
              )
            : "—"
        }
      />


      {pool && (
        <div className="quote-details">

          <div>
            <span>
              Reserve Token 0
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
              Reserve Token 1
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
              Trading fee
            </span>

            <strong>
              0.30%
            </strong>
          </div>


          <div>
            <span>
              Fee amount
            </span>

            <strong>
              {quote
                ? formatTokenAmount(
                    quote.feeAmount,
                    inputDecimals
                  )
                : "—"}
            </strong>
          </div>


          <div>
            <span>
              Slippage tolerance
            </span>

            <strong>
              {formatBps(
                slippageBps
              )}
            </strong>
          </div>


          <div>
            <span>
              Minimum received
            </span>

            <strong>
              {quote
                ? formatTokenAmount(
                    quote.minimumOut,
                    outputDecimals
                  )
                : "—"}
            </strong>
          </div>


          <div>
            <span>
              Price impact
            </span>

            <strong>
              {quote
                ? formatBps(
                    quote.priceImpactBps
                  )
                : "—"}
            </strong>
          </div>

        </div>
      )}


      {transactionError && (
        <div className="pool-message error">
          {transactionError}
        </div>
      )}


      {transactionSignature && (
        <div className="pool-message success">
          Swap confirmed.{" "}

          <a
            href={
              explorerTransactionUrl(
                transactionSignature
              )
            }
            target="_blank"
            rel="noreferrer"
          >
            View transaction ↗
          </a>
        </div>
      )}


      {!connected ? (
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            setVisible(true)
          }
        >
          Connect wallet
        </button>

      ) : !pool ? (

        <button
          className="primary-button"
          disabled
        >
          {loading
            ? "Loading pool..."
            : "Pool unavailable"}
        </button>

      ) : amountInRaw <= 0n ? (

        <button
          className="primary-button"
          disabled
        >
          Enter an amount
        </button>

      ) : amountInRaw >
        inputBalance ? (

        <button
          className="primary-button"
          disabled
        >
          Insufficient balance
        </button>

      ) : !quote ? (

        <button
          className="primary-button"
          disabled
        >
          Invalid quote
        </button>

      ) : (

        <button
          className="primary-button"
          type="button"
          disabled={
            submitting
          }
          onClick={() =>
            void handleSwap()
          }
        >
          {submitting
            ? "Confirming..."
            : `Swap ${fromToken} → ${toToken}`}
        </button>

      )}


      <p className="transaction-note">
        {balancesLoading
          ? "Refreshing wallet balances..."
          : "Quote uses live reserves. The on-chain minimum-output check protects execution."}
      </p>

    </div>
  );
}