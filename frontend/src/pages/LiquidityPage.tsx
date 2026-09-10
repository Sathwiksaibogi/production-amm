import {
  useEffect,
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
  calculateToken0ForToken1,
  calculateToken1ForToken0,
  quoteAddLiquidity,
  quoteRemoveLiquidity,
} from "../amm/liquidity";

import {
  executeAddLiquidity,
  executeRemoveLiquidity,
} from "../amm/transactions";

import {
  explorerTransactionUrl,
} from "../config/solana";


type LiquidityPageProps = {
  poolAddress: string;
};


export function LiquidityPage({
  poolAddress,
}: LiquidityPageProps) {
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
    mode,
    setMode,
  ] =
    useState<
      "add" |
      "remove"
    >("add");


  const [
    amount0,
    setAmount0,
  ] =
    useState("");


  const [
    amount1,
    setAmount1,
  ] =
    useState("");


  const [
    lpAmount,
    setLpAmount,
  ] =
    useState("");


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


  const slippageBps =
    50n;


  useEffect(() => {
    setAmount0("");
    setAmount1("");
    setLpAmount("");

    setTransactionSignature(
      null
    );

    setTransactionError(
      null
    );
  }, [
    poolAddress,
  ]);


  const amount0Raw =
    useMemo(() => {
      if (
        !pool ||
        !amount0
      ) {
        return 0n;
      }

      try {
        return parseTokenAmount(
          amount0,
          pool.token0Decimals
        );
      } catch {
        return 0n;
      }
    }, [
      pool,
      amount0,
    ]);


  const amount1Raw =
    useMemo(() => {
      if (
        !pool ||
        !amount1
      ) {
        return 0n;
      }

      try {
        return parseTokenAmount(
          amount1,
          pool.token1Decimals
        );
      } catch {
        return 0n;
      }
    }, [
      pool,
      amount1,
    ]);


  const lpAmountRaw =
    useMemo(() => {
      if (
        !pool ||
        !lpAmount
      ) {
        return 0n;
      }

      try {
        return parseTokenAmount(
          lpAmount,
          pool.lpDecimals
        );
      } catch {
        return 0n;
      }
    }, [
      pool,
      lpAmount,
    ]);


  const addQuoteResult =
    useMemo(() => {
      if (
        !pool ||
        amount0Raw <= 0n ||
        amount1Raw <= 0n
      ) {
        return {
          quote: null,
          error: null,
        };
      }

      try {
        return {
          quote:
            quoteAddLiquidity(
              pool.reserve0,
              pool.reserve1,
              pool.lpSupply,
              amount0Raw,
              amount1Raw,
              slippageBps
            ),

          error: null,
        };
      } catch (
        caughtError
      ) {
        return {
          quote: null,

          error:
            caughtError
              instanceof Error
              ? caughtError.message
              : "Invalid liquidity quote.",
        };
      }
    }, [
      pool,
      amount0Raw,
      amount1Raw,
      slippageBps,
    ]);


  const removeQuoteResult =
    useMemo(() => {
      if (
        !pool ||
        lpAmountRaw <= 0n
      ) {
        return {
          quote: null,
          error: null,
        };
      }

      try {
        return {
          quote:
            quoteRemoveLiquidity(
              pool.reserve0,
              pool.reserve1,
              pool.lpSupply,
              lpAmountRaw,
              slippageBps
            ),

          error: null,
        };
      } catch (
        caughtError
      ) {
        return {
          quote: null,

          error:
            caughtError
              instanceof Error
              ? caughtError.message
              : "Invalid removal quote.",
        };
      }
    }, [
      pool,
      lpAmountRaw,
      slippageBps,
    ]);


  function handleAmount0Change(
    value: string
  ) {
    setAmount0(value);

    if (
      !pool ||
      pool.lpSupply === 0n
    ) {
      return;
    }

    try {
      const raw =
        parseTokenAmount(
          value,
          pool.token0Decimals
        );

      if (raw <= 0n) {
        setAmount1("");
        return;
      }

      const counterpart =
        calculateToken1ForToken0(
          pool.reserve0,
          pool.reserve1,
          raw
        );

      setAmount1(
        formatTokenAmount(
          counterpart,
          pool.token1Decimals
        )
      );
    } catch {
      setAmount1("");
    }
  }


  function handleAmount1Change(
    value: string
  ) {
    setAmount1(value);

    if (
      !pool ||
      pool.lpSupply === 0n
    ) {
      return;
    }

    try {
      const raw =
        parseTokenAmount(
          value,
          pool.token1Decimals
        );

      if (raw <= 0n) {
        setAmount0("");
        return;
      }

      const counterpart =
        calculateToken0ForToken1(
          pool.reserve0,
          pool.reserve1,
          raw
        );

      setAmount0(
        formatTokenAmount(
          counterpart,
          pool.token0Decimals
        )
      );
    } catch {
      setAmount0("");
    }
  }


  async function refreshAll() {
    await Promise.all([
      refresh(),
      refreshBalances(),
    ]);
  }


  async function handleAddLiquidity() {
    const quote =
      addQuoteResult.quote;

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
        await executeAddLiquidity({
          connection,

          wallet,

          pool,

          amount0Desired:
            amount0Raw,

          amount1Desired:
            amount1Raw,

          minimumAmount0:
            quote.minimumAmount0,

          minimumAmount1:
            quote.minimumAmount1,

          minimumLpOut:
            quote.minimumLpOut,
        });

      setTransactionSignature(
        signature
      );

      setAmount0("");
      setAmount1("");

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
          : "Add liquidity transaction failed."
      );
    } finally {
      setSubmitting(false);
    }
  }


  async function handleRemoveLiquidity() {
    const quote =
      removeQuoteResult.quote;

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
        await executeRemoveLiquidity({
          connection,

          wallet,

          pool,

          lpToBurn:
            lpAmountRaw,

          minimumAmount0Out:
            quote.minimumAmount0Out,

          minimumAmount1Out:
            quote.minimumAmount1Out,
        });

      setTransactionSignature(
        signature
      );

      setLpAmount("");

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
          : "Remove liquidity transaction failed."
      );
    } finally {
      setSubmitting(false);
    }
  }


  const addQuote =
    addQuoteResult.quote;


  const insufficientAddBalance =
    !!addQuote &&
    (
      addQuote.amount0Used >
        balances.token0 ||
      addQuote.amount1Used >
        balances.token1
    );


  return (
    <div className="trade-panel">

      <div className="panel-header">

        <div>
          <div className="section-label">
            LIQUIDITY
          </div>

          <h2>
            Manage position
          </h2>
        </div>


        <div className="mode-switch">

          <button
            className={
              mode === "add"
                ? "active"
                : ""
            }
            type="button"
            onClick={() =>
              setMode("add")
            }
          >
            Add
          </button>


          <button
            className={
              mode === "remove"
                ? "active"
                : ""
            }
            type="button"
            onClick={() =>
              setMode("remove")
            }
          >
            Remove
          </button>

        </div>
      </div>


      {loading && (
        <div className="info-message">
          <span>i</span>

          Loading selected pool...
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

    {" · Reserves "}

    {formatTokenAmount(
      pool.reserve0,
      pool.token0Decimals
    )}

    {" / "}

    {formatTokenAmount(
      pool.reserve1,
      pool.token1Decimals
    )}

    {" · LP supply "}

    {formatTokenAmount(
      pool.lpSupply,
      pool.lpDecimals
    )}

    {" · Your LP "}

    {formatTokenAmount(
      balances.lp,
      pool.lpDecimals
    )}
  </div>
)}


      {mode === "add" ? (
        <>

          <div className="info-message">
            <span>i</span>

            {pool?.lpSupply === 0n
              ? "Initial liquidity: both amounts are independent because you define the starting pool ratio."
              : "Enter either token amount. The counterpart maximum is calculated automatically from the live reserve ratio."}
          </div>


          <TokenField
            label="Maximum Token 0"
            token="Token 0"
            value={amount0}
            onChange={
              handleAmount0Change
            }
            balance={
              pool
                ? formatTokenAmount(
                    balances.token0,
                    pool.token0Decimals
                  )
                : "—"
            }
          />


          <div className="field-gap" />


          <TokenField
            label="Maximum Token 1"
            token="Token 1"
            value={amount1}
            onChange={
              handleAmount1Change
            }
            balance={
              pool
                ? formatTokenAmount(
                    balances.token1,
                    pool.token1Decimals
                  )
                : "—"
            }
          />


          {addQuoteResult.error && (
            <div className="pool-message error">
              {addQuoteResult.error}
            </div>
          )}


          <div className="quote-details">

            <div>
              <span>
                Token 0 actually used
              </span>

              <strong>
                {pool && addQuote
                  ? formatTokenAmount(
                      addQuote.amount0Used,
                      pool.token0Decimals
                    )
                  : "—"}
              </strong>
            </div>


            <div>
              <span>
                Token 1 actually used
              </span>

              <strong>
                {pool && addQuote
                  ? formatTokenAmount(
                      addQuote.amount1Used,
                      pool.token1Decimals
                    )
                  : "—"}
              </strong>
            </div>


            <div>
              <span>
                LP tokens expected
              </span>

              <strong>
                {pool && addQuote
                  ? formatTokenAmount(
                      addQuote.lpMinted,
                      pool.lpDecimals
                    )
                  : "—"}
              </strong>
            </div>


            <div>
              <span>
                Minimum LP
              </span>

              <strong>
                {pool && addQuote
                  ? formatTokenAmount(
                      addQuote.minimumLpOut,
                      pool.lpDecimals
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
                New position share
              </span>

              <strong>
                {addQuote
                  ? formatBps(
                      addQuote.providerShareBps
                    )
                  : "—"}
              </strong>
            </div>

            <div>
  <span>
    Total LP supply
  </span>

  <strong>
    {pool
      ? formatTokenAmount(
          pool.lpSupply,
          pool.lpDecimals
        )
      : "—"}
  </strong>
</div>


<div>
  <span>
    Your LP balance
  </span>

  <strong>
    {pool
      ? formatTokenAmount(
          balances.lp,
          pool.lpDecimals
        )
      : "—"}
  </strong>
</div>

          </div>


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
              Pool unavailable
            </button>

          ) : insufficientAddBalance ? (

            <button
              className="primary-button"
              disabled
            >
              Insufficient token balance
            </button>

          ) : !addQuote ? (

            <button
              className="primary-button"
              disabled
            >
              Enter liquidity amount
            </button>

          ) : (

            <button
              className="primary-button"
              type="button"
              disabled={
                submitting
              }
              onClick={() =>
                void handleAddLiquidity()
              }
            >
              {submitting
                ? "Confirming..."
                : "Add liquidity"}
            </button>

          )}

        </>
      ) : (
        <>

          <div className="info-message">
            <span>i</span>

            Burn LP tokens to
            withdraw your proportional
            share of both reserves.
          </div>


          <TokenField
            label="LP tokens to burn"
            token="LP"
            value={lpAmount}
            onChange={
              setLpAmount
            }
            balance={
              pool
                ? formatTokenAmount(
                    balances.lp,
                    pool.lpDecimals
                  )
                : "—"
            }
          />


          {removeQuoteResult.error && (
            <div className="pool-message error">
              {removeQuoteResult.error}
            </div>
          )}


          <div className="quote-details">

            <div>
              <span>
                Token 0 received
              </span>

              <strong>
                {pool &&
                removeQuoteResult.quote
                  ? formatTokenAmount(
                      removeQuoteResult
                        .quote
                        .amount0Out,

                      pool.token0Decimals
                    )
                  : "—"}
              </strong>
            </div>


            <div>
              <span>
                Token 1 received
              </span>

              <strong>
                {pool &&
                removeQuoteResult.quote
                  ? formatTokenAmount(
                      removeQuoteResult
                        .quote
                        .amount1Out,

                      pool.token1Decimals
                    )
                  : "—"}
              </strong>
            </div>


            <div>
              <span>
                Minimum Token 0
              </span>

              <strong>
                {pool &&
                removeQuoteResult.quote
                  ? formatTokenAmount(
                      removeQuoteResult
                        .quote
                        .minimumAmount0Out,

                      pool.token0Decimals
                    )
                  : "—"}
              </strong>
            </div>


            <div>
              <span>
                Minimum Token 1
              </span>

              <strong>
                {pool &&
                removeQuoteResult.quote
                  ? formatTokenAmount(
                      removeQuoteResult
                        .quote
                        .minimumAmount1Out,

                      pool.token1Decimals
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

          </div>


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

          ) : lpAmountRaw >
              balances.lp ? (

            <button
              className="primary-button"
              disabled
            >
              Insufficient LP balance
            </button>

          ) : !removeQuoteResult.quote ? (

            <button
              className="primary-button"
              disabled
            >
              Enter LP amount
            </button>

          ) : (

            <button
              className="primary-button"
              type="button"
              disabled={
                submitting
              }
              onClick={() =>
                void handleRemoveLiquidity()
              }
            >
              {submitting
                ? "Confirming..."
                : "Remove liquidity"}
            </button>

          )}

        </>
      )}


      {transactionError && (
        <div className="pool-message error">
          {transactionError}
        </div>
      )}


      {transactionSignature && (
        <div className="pool-message success">

          Transaction confirmed.{" "}

          <a
            href={
              explorerTransactionUrl(
                transactionSignature
              )
            }
            target="_blank"
            rel="noreferrer"
          >
            View on Explorer ↗
          </a>

        </div>
      )}

    </div>
  );
}