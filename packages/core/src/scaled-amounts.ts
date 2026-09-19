import { LaunchError, formatUnits } from "./launchpad";

/** Exact rational form of the mint's IEEE-754 multiplier. No float conversion of token balances. */
function multiplierRatio(multiplier: number): [bigint, bigint] {
  if (!Number.isFinite(multiplier) || multiplier <= 0)
    throw new LaunchError({
      message: "Invalid token scaling multiplier.",
      status: 503,
    });
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, multiplier);
  const bits = view.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n);
  let numerator = bits & ((1n << 52n) - 1n);
  if (exponent) numerator += 1n << 52n;
  const shift = (exponent ? exponent - 1023 : -1022) - 52;
  return shift >= 0
    ? [numerator << BigInt(shift), 1n]
    : [numerator, 1n << BigInt(-shift)];
}

/** Displayed input is a spending ceiling. Round down so conversion cannot overspend it. */
export function parseScaledUnits(
  value: string,
  decimals: number,
  multiplier = 1,
): bigint {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 9 ||
    !/^\d+(\.\d+)?$/.test(value) ||
    value.length > 40
  )
    throw new LaunchError({
      message: "Enter a positive decimal amount.",
      status: 400,
    });
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new LaunchError({
      message: `Use no more than ${decimals} decimal places.`,
      status: 400,
    });
  const units =
      BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, "0")),
    [numerator, denominator] = multiplierRatio(multiplier);
  const raw = (units * denominator) / numerator;
  if (raw <= 0n || raw > 18_446_744_073_709_551_615n)
    throw new LaunchError({
      message: "Amount is outside the supported range.",
      status: 400,
    });
  return raw;
}

/** Match token UI precision, truncating sub-decimal dust without losing large integer amounts. */
export function formatScaledUnits(
  value: string | bigint,
  decimals: number,
  multiplier = 1,
): string {
  const raw = BigInt(value),
    [numerator, denominator] = multiplierRatio(multiplier);
  if (raw < 0n)
    throw new LaunchError({ message: "Invalid token amount.", status: 400 });
  return formatUnits((raw * numerator) / denominator, decimals);
}
