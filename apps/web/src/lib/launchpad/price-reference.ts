/** All server accounting uses USD per unscaled whole token, matching DBC reserves and events. */
export function rawUsdReference(
  input: unknown,
  decimals: number,
  multiplier = 1,
  now = Date.now(),
): { usd: number; block: number } | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (
    typeof value.usdPrice !== "number" ||
    !Number.isFinite(value.usdPrice) ||
    value.usdPrice <= 0 ||
    value.decimals !== decimals ||
    !Number.isSafeInteger(value.blockId) ||
    Number(value.blockId) <= 0 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0
  )
    return null;
  const usd = value.usdPrice * multiplier;
  if (!Number.isFinite(usd) || usd <= 0) return null;
  if (value.scaledUiConfig) {
    const scale = value.scaledUiConfig as Record<string, unknown>;
    const effectiveAt =
      typeof scale.newMultiplierEffectiveAt === "string"
        ? Date.parse(scale.newMultiplierEffectiveAt)
        : NaN;
    const apiMultiplier =
      now >= effectiveAt ? scale.newMultiplier : scale.multiplier;
    if (
      !Number.isFinite(effectiveAt) ||
      typeof apiMultiplier !== "number" ||
      Math.abs(apiMultiplier - multiplier) > 1e-12 * multiplier ||
      typeof scale.usdPricePrescaled !== "number" ||
      !Number.isFinite(scale.usdPricePrescaled) ||
      Math.abs(scale.usdPricePrescaled - usd) > 1e-8 * usd
    )
      return null;
  } else if (multiplier !== 1) {
    // A scaled issuer price without declared units cannot safely value raw balances.
    return null;
  }
  return { usd, block: Number(value.blockId) };
}
