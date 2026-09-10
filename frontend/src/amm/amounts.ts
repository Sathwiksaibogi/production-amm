export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  maxFractionDigits = 9
): string {
  const negative =
    amount < 0n;

  const absolute =
    negative
      ? -amount
      : amount;

  const base =
    10n **
    BigInt(decimals);

  const whole =
    absolute / base;

  const remainder =
    absolute % base;

  if (
    remainder === 0n ||
    decimals === 0
  ) {
    return `${negative ? "-" : ""}${whole}`;
  }

  let fraction =
    remainder
      .toString()
      .padStart(
        decimals,
        "0"
      );

  fraction =
    fraction
      .slice(
        0,
        maxFractionDigits
      )
      .replace(
        /0+$/,
        ""
      );

  if (!fraction) {
    return `${negative ? "-" : ""}${whole}`;
  }

  return (
    `${negative ? "-" : ""}` +
    `${whole}.${fraction}`
  );
}

export function parseTokenAmount(
  value: string,
  decimals: number
): bigint {
  const normalized =
    value.trim();

  if (
    normalized === "" ||
    normalized === "."
  ) {
    return 0n;
  }

  if (
    !/^\d*\.?\d*$/.test(
      normalized
    )
  ) {
    throw new Error(
      "Invalid token amount."
    );
  }

  const [
    wholePart = "0",
    fractionPart = "",
  ] =
    normalized.split(".");

  if (
    fractionPart.length >
    decimals
  ) {
    throw new Error(
      `Token supports only ${decimals} decimal places.`
    );
  }

  const paddedFraction =
    fractionPart.padEnd(
      decimals,
      "0"
    );

  const base =
    10n **
    BigInt(decimals);

  const whole =
    BigInt(
      wholePart || "0"
    );

  const fraction =
    paddedFraction
      ? BigInt(
          paddedFraction
        )
      : 0n;

  return (
    whole * base +
    fraction
  );
}

export function formatBps(
  bps: bigint
): string {
  const whole =
    bps / 100n;

  const fraction =
    (
      bps %
      100n
    )
      .toString()
      .padStart(
        2,
        "0"
      );

  return `${whole}.${fraction}%`;
}

export function shortenAddress(
  address: string,
  visible = 5
): string {
  return (
    address.slice(
      0,
      visible
    ) +
    "..." +
    address.slice(
      -visible
    )
  );
}