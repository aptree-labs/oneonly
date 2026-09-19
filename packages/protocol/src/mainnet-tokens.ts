/** Official issuer mints; classic SPL, 6 decimals, no mint/freeze authorities.
 * Verified on mainnet 2026-09-16. Sources:
 * https://discuss.jup.ag/t/jup-the-genesis-post/478
 * https://ir.meteora.ag/ (official Buy MET link)
 */
export const MAINNET_TOKENS = [
  {
    symbol: "JUP",
    name: "Jupiter",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
    setupTargetUsd: 10_000,
  },
  {
    symbol: "MET",
    name: "Meteora",
    mint: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL",
    decimals: 6,
    setupTargetUsd: 10_000,
  },
] as const;

/** Round up to whole tokens; the owner signs this fixed quantity, not a USD peg. */
export function tokenSetupThreshold(symbol: string, usdPrice: number) {
  const asset = MAINNET_TOKENS.find((asset) => asset.symbol === symbol);
  if (!asset || !Number.isFinite(usdPrice) || usdPrice <= 0)
    throw new Error("A current USD price is required for this configuration.");
  const threshold = Math.ceil(asset.setupTargetUsd / usdPrice);
  if (
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    threshold > 1_000_000_000
  )
    throw new Error("Configuration threshold is outside the supported range.");
  return threshold;
}
