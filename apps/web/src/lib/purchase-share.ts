export type TradeShareSide = "buy" | "sell";
export const purchaseShareOrigin = "https://oneonly.lol";
export const purchaseSharePath = (id: string) =>
  `/app/share/${encodeURIComponent(id)}`;
export const tradeShareUrl = (
  id: string,
  side: TradeShareSide = "buy",
  saleId?: string,
) =>
  `${purchaseShareOrigin}${purchaseSharePath(id)}${side === "sell" ? `?side=sell${saleId ? `&sale=${encodeURIComponent(saleId)}` : ""}` : ""}`;
export const purchaseShareText = (
  ticker?: string,
  side: TradeShareSide = "buy",
) =>
  ticker
    ? `Just ${side === "sell" ? "sold" : "bought"} $${ticker} on One Only.`
    : `Just ${side === "sell" ? "sold" : "bought in"} on One Only.`;
export function purchaseShareIntent(
  id: string,
  ticker?: string,
  side: TradeShareSide = "buy",
  saleId?: string,
) {
  return `https://x.com/intent/tweet?${new URLSearchParams({ text: purchaseShareText(ticker, side), url: tradeShareUrl(id, side, saleId) })}`;
}
