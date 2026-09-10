const BPS_DENOMINATOR =
  10_000n;

export const SWAP_FEE_BPS =
  30n;

export type SwapQuote = {
  amountIn: bigint;

  feeAmount: bigint;

  amountInAfterFee:
    bigint;

  amountOut: bigint;

  minimumOut: bigint;

  slippageBps: bigint;

  priceImpactBps:
    bigint;
};

export function quoteExactInput(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn: bigint,
  slippageBps = 50n
): SwapQuote {
  if (
    reserveIn <= 0n ||
    reserveOut <= 0n
  ) {
    throw new Error(
      "Pool reserves must be positive."
    );
  }

  if (amountIn <= 0n) {
    throw new Error(
      "Swap amount must be positive."
    );
  }

  if (
    slippageBps < 0n ||
    slippageBps >=
      BPS_DENOMINATOR
  ) {
    throw new Error(
      "Invalid slippage tolerance."
    );
  }

  const feeAmount =
    (
      amountIn *
      SWAP_FEE_BPS
    ) /
    BPS_DENOMINATOR;

  const amountInAfterFee =
    amountIn -
    feeAmount;

  const numerator =
    reserveOut *
    amountInAfterFee;

  const denominator =
    reserveIn +
    amountInAfterFee;

  const amountOut =
    numerator /
    denominator;

  if (amountOut <= 0n) {
    throw new Error(
      "Swap output rounds to zero."
    );
  }

  const minimumOut =
    (
      amountOut *
      (
        BPS_DENOMINATOR -
        slippageBps
      )
    ) /
    BPS_DENOMINATOR;

  /*
   * Compare:
   *
   * spot price
   *   reserveOut / reserveIn
   *
   * execution price
   *   amountOut / amountIn
   *
   * without floating-point arithmetic.
   */
  const executionNumerator =
    amountOut *
    reserveIn *
    BPS_DENOMINATOR;

  const executionDenominator =
    amountIn *
    reserveOut;

  const executionRatioBps =
    executionNumerator /
    executionDenominator;

  const priceImpactBps =
    executionRatioBps >=
    BPS_DENOMINATOR
      ? 0n
      : BPS_DENOMINATOR -
        executionRatioBps;

  return {
    amountIn,

    feeAmount,

    amountInAfterFee,

    amountOut,

    minimumOut,

    slippageBps,

    priceImpactBps,
  };
}