const BPS_DENOMINATOR = 10_000n;

export const MINIMUM_LIQUIDITY = 1_000n;


function applySlippage(
  amount: bigint,
  slippageBps: bigint
): bigint {
  if (
    slippageBps < 0n ||
    slippageBps >= BPS_DENOMINATOR
  ) {
    throw new Error(
      "Invalid slippage tolerance."
    );
  }

  return (
    amount *
    (
      BPS_DENOMINATOR -
      slippageBps
    )
  ) / BPS_DENOMINATOR;
}


function ceilDiv(
  numerator: bigint,
  denominator: bigint
): bigint {
  if (denominator <= 0n) {
    throw new Error(
      "Division denominator must be positive."
    );
  }

  const quotient =
    numerator / denominator;

  const remainder =
    numerator % denominator;

  return remainder === 0n
    ? quotient
    : quotient + 1n;
}


function integerSqrt(
  value: bigint
): bigint {
  if (value < 0n) {
    throw new Error(
      "Cannot calculate square root of a negative value."
    );
  }

  if (value < 2n) {
    return value;
  }

  let low = 1n;
  let high = value;
  let answer = 1n;

  while (low <= high) {
    const mid =
      (low + high) / 2n;

    if (
      mid <=
      value / mid
    ) {
      answer = mid;
      low = mid + 1n;
    } else {
      high = mid - 1n;
    }
  }

  return answer;
}


export function calculateToken1ForToken0(
  reserve0: bigint,
  reserve1: bigint,
  amount0: bigint
): bigint {
  if (
    reserve0 <= 0n ||
    reserve1 <= 0n ||
    amount0 <= 0n
  ) {
    return 0n;
  }

  return ceilDiv(
    amount0 * reserve1,
    reserve0
  );
}


export function calculateToken0ForToken1(
  reserve0: bigint,
  reserve1: bigint,
  amount1: bigint
): bigint {
  if (
    reserve0 <= 0n ||
    reserve1 <= 0n ||
    amount1 <= 0n
  ) {
    return 0n;
  }

  return ceilDiv(
    amount1 * reserve0,
    reserve1
  );
}


export type AddLiquidityQuote = {
  lpMinted: bigint;

  minimumLpOut: bigint;

  amount0Used: bigint;

  amount1Used: bigint;

  minimumAmount0: bigint;

  minimumAmount1: bigint;

  providerShareBps: bigint;

  initialDeposit: boolean;
};


export function quoteAddLiquidity(
  reserve0: bigint,
  reserve1: bigint,
  lpSupply: bigint,
  amount0Desired: bigint,
  amount1Desired: bigint,
  slippageBps = 50n
): AddLiquidityQuote {
  if (
    amount0Desired <= 0n ||
    amount1Desired <= 0n
  ) {
    throw new Error(
      "Both desired deposit amounts must be greater than zero."
    );
  }

  /*
   * Initial liquidity.
   *
   * First LP chooses the starting ratio.
   */
  if (lpSupply === 0n) {
    const totalInitialLp =
      integerSqrt(
        amount0Desired *
        amount1Desired
      );

    if (
      totalInitialLp <=
      MINIMUM_LIQUIDITY
    ) {
      throw new Error(
        "Initial deposit is too small to satisfy minimum locked liquidity."
      );
    }

    const providerLp =
      totalInitialLp -
      MINIMUM_LIQUIDITY;

    return {
      lpMinted:
        providerLp,

      minimumLpOut:
        applySlippage(
          providerLp,
          slippageBps
        ),

      amount0Used:
        amount0Desired,

      amount1Used:
        amount1Desired,

      minimumAmount0:
        applySlippage(
          amount0Desired,
          slippageBps
        ),

      minimumAmount1:
        applySlippage(
          amount1Desired,
          slippageBps
        ),

      providerShareBps:
        (
          providerLp *
          BPS_DENOMINATOR
        ) /
        totalInitialLp,

      initialDeposit: true,
    };
  }

  /*
   * Existing pool.
   */
  if (
    reserve0 <= 0n ||
    reserve1 <= 0n
  ) {
    throw new Error(
      "Existing pool has invalid reserves."
    );
  }

  /*
   * How many LP units could each desired
   * token amount independently support?
   */
  const lpFrom0 =
    (
      amount0Desired *
      lpSupply
    ) /
    reserve0;

  const lpFrom1 =
    (
      amount1Desired *
      lpSupply
    ) /
    reserve1;

  /*
   * Limiting asset determines LP minted.
   */
  const lpMinted =
    lpFrom0 < lpFrom1
      ? lpFrom0
      : lpFrom1;

  if (lpMinted <= 0n) {
    throw new Error(
      "Deposit is too small to mint LP tokens."
    );
  }

  /*
   * Mirror Rust ceil_div().
   */
  const amount0Used =
    ceilDiv(
      lpMinted *
        reserve0,
      lpSupply
    );

  const amount1Used =
    ceilDiv(
      lpMinted *
        reserve1,
      lpSupply
    );

  if (
    amount0Used >
      amount0Desired ||
    amount1Used >
      amount1Desired
  ) {
    throw new Error(
      "Calculated deposit exceeds desired maximum."
    );
  }

  const newSupply =
    lpSupply +
    lpMinted;

  const providerShareBps =
    (
      lpMinted *
      BPS_DENOMINATOR
    ) /
    newSupply;

  return {
    lpMinted,

    minimumLpOut:
      applySlippage(
        lpMinted,
        slippageBps
      ),

    amount0Used,

    amount1Used,

    minimumAmount0:
      applySlippage(
        amount0Used,
        slippageBps
      ),

    minimumAmount1:
      applySlippage(
        amount1Used,
        slippageBps
      ),

    providerShareBps,

    initialDeposit: false,
  };
}


export type RemoveLiquidityQuote = {
  amount0Out: bigint;

  amount1Out: bigint;

  minimumAmount0Out: bigint;

  minimumAmount1Out: bigint;
};


export function quoteRemoveLiquidity(
  reserve0: bigint,
  reserve1: bigint,
  lpSupply: bigint,
  lpToBurn: bigint,
  slippageBps = 50n
): RemoveLiquidityQuote {
  if (lpSupply <= 0n) {
    throw new Error(
      "Pool has no LP supply."
    );
  }

  if (lpToBurn <= 0n) {
    throw new Error(
      "LP burn amount must be greater than zero."
    );
  }

  if (lpToBurn > lpSupply) {
    throw new Error(
      "LP burn exceeds total supply."
    );
  }

  const amount0Out =
    (
      reserve0 *
      lpToBurn
    ) /
    lpSupply;

  const amount1Out =
    (
      reserve1 *
      lpToBurn
    ) /
    lpSupply;

  if (
    amount0Out <= 0n ||
    amount1Out <= 0n
  ) {
    throw new Error(
      "LP burn is too small to withdraw both assets."
    );
  }

  return {
    amount0Out,

    amount1Out,

    minimumAmount0Out:
      applySlippage(
        amount0Out,
        slippageBps
      ),

    minimumAmount1Out:
      applySlippage(
        amount1Out,
        slippageBps
      ),
  };
}