import { marketCandles, type CandleInterval, type Database } from "@oneonly/db";
/** Keep original quote history visible when USD conversion evidence is missing. */
export async function chartHistory(
  db: Database,
  tokenId: string,
  interval: CandleInterval,
  before: number | undefined,
  requested: "usd" | "quote",
  fallback: boolean,
) {
  let currency = requested;
  let history = await marketCandles(db, tokenId, interval, before, currency);
  if (requested === "usd" && fallback && !history.candles.length) {
    const quoteHistory = await marketCandles(
      db,
      tokenId,
      interval,
      before,
      "quote",
    );
    if (quoteHistory.candles.length) {
      history = quoteHistory;
      currency = "quote";
    }
  }
  return {
    ...history,
    currency,
    requestedCurrency: requested,
    fallback: currency !== requested,
  };
}
