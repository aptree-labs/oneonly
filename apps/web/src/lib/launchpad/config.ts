import {
  configuredPool,
  NETWORK,
  quoteAssets,
  quoteMultiplier,
} from "@oneonly/protocol";
import { prices } from "./price";
let cached:
  | { expires: number; value: Awaited<ReturnType<typeof readConfig>> }
  | undefined;
async function readConfig() {
  const references = await prices().catch(() => null);
  const readQuote = async (asset: ReturnType<typeof quoteAssets>[number]) => {
    let reason = asset.unavailableReason || "";
    if (!reason && !asset.config) reason = "Pool configuration pending";
    else if (!reason) {
      try {
        await configuredPool(asset.symbol);
      } catch {
        reason = "Pool configuration could not be verified";
      }
    }
    const creationEnabled = !reason;
    if (!reason && !references?.[asset.symbol])
      reason = "Current USD reference unavailable";
    const multiplier = await quoteMultiplier(asset.symbol).catch(() => null);
    if (multiplier === null && !reason)
      reason = "Current token scale unavailable";
    return {
      ...asset,
      enabled: !reason,
      creationEnabled,
      reason: reason || null,
      multiplier,
      displayUsdPrice:
        multiplier && references?.[asset.symbol]
          ? references[asset.symbol] / multiplier
          : null,
    };
  };
  const assets = quoteAssets();
  const quotes = [];
  for (let i = 0; i < assets.length; i += 2) {
    quotes.push(...(await Promise.all(assets.slice(i, i + 2).map(readQuote))));
  }
  return {
    network: NETWORK,
    quotes,
    prices: references,
    tickerPolicy:
      "Below $100 per complete UTC day for 30 days across every pool",
    fees: { dbc: 1.25, creator: 0.5, platform: 0.5, protocol: 0.25 },
  };
}
let pending: Promise<Awaited<ReturnType<typeof readConfig>>> | undefined;
export async function appConfig() {
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pending) return pending;
  pending = readConfig()
    .then((value) => {
      cached = { value, expires: Date.now() + 30_000 };
      return value;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
