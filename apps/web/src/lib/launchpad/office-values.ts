/** Values native quote totals at the current raw-token reference, not at claim time. */
export function feeUsdTotals(
  assets: { symbol: string; revenue: string; creatorPayouts: string }[],
  references: Record<string, number> | null,
) {
  let revenue = 0,
    creatorPayouts = 0,
    priced = 0,
    complete = true;
  for (const asset of assets) {
    const earned = Number(asset.revenue),
      paid = Number(asset.creatorPayouts);
    if (earned === 0 && paid === 0) {
      priced++;
      continue;
    }
    const price = references?.[asset.symbol];
    if (
      !price ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(earned) ||
      !Number.isFinite(paid)
    ) {
      complete = false;
      continue;
    }
    revenue += earned * price;
    creatorPayouts += paid * price;
    priced++;
  }
  return {
    revenue: priced || !assets.length ? revenue : null,
    creatorPayouts: priced || !assets.length ? creatorPayouts : null,
    complete,
  };
}
