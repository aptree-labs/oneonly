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
  const normalized = ticker.trim().replace(/^\$/, "").toUpperCase();
  return {
    ticker: /^[A-Z0-9]{1,10}$/.test(normalized) ? normalized : "",
    quote: pairs.has(pair) ? pair : "SOL",
  };
}
export function createTickerHref(ticker: string, pair: string) {
  const value = createPrefill(ticker, pair);
  return value.ticker ? `/app/create?${new URLSearchParams(value)}` : null;
}
