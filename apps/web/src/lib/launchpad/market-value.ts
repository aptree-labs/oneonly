/** Multiply raw pool units by USD per raw quote token, before UI stock scaling. */
export function marketValue(
  token: { quote: string; quoteMint?: string | null },
  snapshot: {
    marketCapQuote: string;
    graduated: boolean;
    marketVenue?: string | null;
  } | null,
  references: Record<string, number> | null,
  assets: { symbol: string; mint: string }[],
): number | null {
  const asset = assets.find((item) => item.symbol === token.quote);
  if (
    !asset ||
    (token.quoteMint && token.quoteMint !== asset.mint) ||
    !snapshot ||
    (snapshot.graduated && snapshot.marketVenue !== "damm-v2")
  )
    return null;
  const price = references?.[token.quote];
  const cap = Number(snapshot.marketCapQuote);
  if (
    !price ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !snapshot.marketCapQuote.trim() ||
    !Number.isFinite(cap) ||
    cap < 0
  )
    return null;
  const usd = cap * price;
  return Number.isFinite(usd) ? usd : null;
}
