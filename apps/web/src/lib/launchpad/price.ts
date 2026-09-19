import { GENESIS_HASHES } from "@oneonly/core";
import {
  quoteAssets,
  MAINNET_STOCKS,
  inspectStockSetup,
  USDC_MINTS,
} from "@oneonly/protocol";
import { Connection } from "@solana/web3.js";
import { historicalStockUsd } from "./stock-history";
import { rawUsdReference } from "./price-reference";
type References = { timestamp: number } & Record<string, number>;
let cached: References | undefined;
let pending: Promise<References> | undefined;
export async function prices() {
  if (cached && Date.now() - cached.timestamp < 15_000) return cached;
  // Coalesce concurrent requests to respect the provider's keyless rate limit.
  if (pending) return pending;
  pending = readPrices().finally(() => {
    pending = undefined;
  });
  return pending;
}
async function readPrices(): Promise<References> {
  const custom: Record<string, number> = {};
  // Independent fallback requests: an outage for one asset cannot erase others.
  const fallback = Promise.all(
    (["SOL", "USDC"] as const).map(async (symbol) => {
      try {
        const response = await fetch(
          `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,
          { signal: AbortSignal.timeout(7000), cache: "no-store" },
        );
        if (!response.ok) return null;
        const data = await response.json();
        const price = Number(data.data?.amount);
        return Number.isFinite(price) && price > 0 && data.data?.base === symbol
          ? { symbol, price }
          : null;
      } catch {
        return null;
      }
    }),
  );
  const assets = quoteAssets()
    .map((asset) => ({
      ...asset,
      referenceMint:
        asset.symbol === "SOL"
          ? asset.mint
          : asset.symbol === "USDC"
            ? USDC_MINTS["mainnet-beta"]
            : asset.referenceMint,
    }))
    .filter((asset) => asset.referenceMint);
  if (assets.length) {
    try {
      const result = await fetch(
        `https://api.jup.ag/price/v3?ids=${assets.map((asset) => asset.referenceMint).join(",")}`,
        {
          headers: process.env.JUPITER_API_KEY
            ? { "x-api-key": process.env.JUPITER_API_KEY }
            : undefined,
          signal: AbortSignal.timeout(7000),
          cache: "no-store",
        },
      );
      if (result.ok) {
        const data = await result.json();
        const rpc = new Connection(
          process.env.MAINNET_PRICE_RPC_URL ||
            (process.env.SOLANA_NETWORK === "mainnet-beta"
              ? process.env.SOLANA_RPC_URL
              : undefined) ||
            "https://api.mainnet-beta.solana.com",
        );
        if ((await rpc.getGenesisHash()) !== GENESIS_HASHES["mainnet-beta"])
          throw new Error("Price reference RPC must be mainnet");
        const blockTimes = new Map<number, Promise<number | null>>();
        const blockTime = (block: number) => {
          if (!blockTimes.has(block))
            blockTimes.set(block, rpc.getBlockTime(block));
          return blockTimes.get(block)!;
        };
        await Promise.all(
          assets.map(async (asset) => {
            try {
              const stock = MAINNET_STOCKS.find(
                (item) => item.mint === asset.referenceMint,
              );
              const multiplier = stock
                ? (await inspectStockSetup(rpc, stock.symbol)).multiplier
                : 1;
              const price = rawUsdReference(
                data[asset.referenceMint!],
                stock?.decimals ?? asset.decimals,
                multiplier,
              );
              if (!price) return;
              const time = await blockTime(price.block);
              if (
                time &&
                Date.now() - time * 1000 >= 0 &&
                Date.now() - time * 1000 < 120_000
              )
                custom[asset.symbol] = price.usd;
            } catch {
              // A single unavailable stock must not suppress the other references.
            }
          }),
        );
      }
    } catch {
      /* Unsupported, stale or missing prices keep that pair closed for new launches. */
    }
  }
  for (const value of await fallback) {
    if (value && !custom[value.symbol]) custom[value.symbol] = value.price;
  }
  cached = { ...custom, timestamp: Date.now() };
  return cached;
}
/** The candle high is deliberately conservative: uncertain valuation never frees a ticker. */
const historicalCache = new Map<
  string,
  { value: number | null; expires: number }
>();
const historicalPending = new Map<string, Promise<number | null>>();
/** Many swaps share the same completed minute; fetch its reference only once. */
export async function historicalUsd(
  symbol: string,
  time: Date,
): Promise<number | null> {
  if (symbol !== "SOL" && symbol !== "USDC")
    return historicalStockUsd(symbol, time);
  const minute = Math.floor(time.getTime() / 60_000);
  if (!Number.isFinite(minute)) return null;
  const key = `${symbol}:${minute}`,
    cached = historicalCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const pending = historicalPending.get(key);
  if (pending) return pending;
  const work = readHistoricalUsd(symbol, time)
    .then((value) => {
      historicalCache.delete(key);
      historicalCache.set(key, {
        value,
        expires: Date.now() + (value === null ? 15_000 : 3_600_000),
      });
      if (historicalCache.size > 2048)
        historicalCache.delete(historicalCache.keys().next().value!);
      return value;
    })
    .finally(() => historicalPending.delete(key));
  historicalPending.set(key, work);
  return work;
}

async function readHistoricalUsd(
  symbol: string,
  time: Date,
): Promise<number | null> {
  // Jupiter's current price is not historical evidence. Unsupported history never releases a ticker.
  if (symbol !== "SOL" && symbol !== "USDC")
    return historicalStockUsd(symbol, time);
  const start = new Date(Math.floor(time.getTime() / 60_000) * 60_000),
    end = new Date(start.getTime() + 60_000);
  if (!Number.isFinite(end.getTime()) || end.getTime() > Date.now())
    return null;
  try {
    const result = await fetch(
      `https://api.exchange.coinbase.com/products/${symbol}-USD/candles?granularity=60&start=${start.toISOString()}&end=${end.toISOString()}`,
      { signal: AbortSignal.timeout(7000), cache: "no-store" },
    );
    if (!result.ok) return null;
    const data: number[][] = await result.json(),
      candle = data.find((row) => row[0] === start.getTime() / 1000);
    return candle && candle[2] > 0 && Number.isFinite(candle[2])
      ? candle[2]
      : null;
  } catch {
    return null;
  }
}
