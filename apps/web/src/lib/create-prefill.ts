import { isReservedLaunchTicker, normalizeTicker } from "@oneonly/core";
const pairs = new Set([
  "SOL",
  "USDC",
  "JUP",
  "MET",
  "SPYX",
  "QQQX",
  "NVDAX",
  "TSLAX",
  "CRCLX",
]);
export function createPrefill(ticker: string, pair: string) {
  let normalized = "";
  try {
    normalized = normalizeTicker(ticker);
  } catch {
    /* Search text need not be a valid ticker. */
  }
  return {
    ticker: normalized,
    quote: pairs.has(pair) ? pair : "SOL",
  };
}
export function createTickerHref(ticker: string, pair: string) {
  const value = createPrefill(ticker, pair);
  return value.ticker && !isReservedLaunchTicker(value.ticker)
    ? `/app/create?${new URLSearchParams(value)}`
    : null;
}

export function createCreatorHref(xId: string, pair = "SOL") {
  if (!/^[1-9]\d{0,24}$/.test(xId)) return null;
  return `/app/create?${new URLSearchParams({ creator: xId, quote: createPrefill("", pair).quote })}`;
}
