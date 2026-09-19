import { MAINNET_STOCKS, MAINNET_TOKENS, USDC_MINTS } from "@oneonly/protocol";
const poolCache = new Map<string, { expires: number; address: string }>();
const candleCache = new Map<string, Promise<number | null>>();
const usdc = USDC_MINTS["mainnet-beta"];
async function read(path: string) {
  const response = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/solana/${path}`,
    { cache: "no-store", signal: AbortSignal.timeout(7000) },
  );
  if (!response.ok) throw new Error("Historical price source unavailable");
  return response.json();
}
export function stockCandleHigh(
  data: any,
  mint: string,
  minute: number,
): number | null {
  if (data?.meta?.base?.address !== mint || data?.meta?.quote?.address !== usdc)
    return null;
  const candle = data?.data?.attributes?.ohlcv_list?.find(
    (row: unknown[]) => Array.isArray(row) && row[0] === minute,
  );
  if (
    !candle ||
    candle.length < 6 ||
    !candle
      .slice(1, 6)
      .every(
        (value: unknown) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0,
      ) ||
    candle[3] <= 0 ||
    candle[2] < Math.max(candle[1], candle[3], candle[4])
  )
    return null;
  // These on-chain OHLC prices are per raw whole token, matching stored swap amounts.
  return candle[2];
}
async function stockPool(mint: string) {
  const cached = poolCache.get(mint);
  if (cached && cached.expires > Date.now()) return cached.address;
  const data = await read(`tokens/${mint}/pools`);
  const pool = data?.data
    ?.filter(
      (item: any) =>
        item.relationships?.base_token?.data?.id === `solana_${mint}` &&
        item.relationships?.quote_token?.data?.id === `solana_${usdc}` &&
        Number(item.attributes?.reserve_in_usd) >= 100_000,
    )
    .sort(
      (a: any, b: any) =>
        Number(b.attributes.reserve_in_usd) -
        Number(a.attributes.reserve_in_usd),
    )[0];
  if (!pool || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pool.attributes.address))
    throw new Error("No liquid matching stock/USDC history pool");
  poolCache.set(mint, {
    address: pool.attributes.address,
    expires: Date.now() + 3600_000,
  });
  return pool.attributes.address as string;
}
/** Missing candles are unknown, never zero volume and never grounds to free a ticker. */
export async function historicalStockUsd(
  symbol: string,
  time: Date,
): Promise<number | null> {
  const asset = [...MAINNET_STOCKS, ...MAINNET_TOKENS].find(
    (asset) => asset.symbol === symbol,
  );
  if (!asset) return null;
  const minute = Math.floor(time.getTime() / 60_000) * 60,
    key = `${asset.mint}:${minute}`;
  // Do not persist a partial candle: the minute high can still change.
  if (!Number.isFinite(minute) || (minute + 60) * 1000 > Date.now())
    return null;
  const cached = candleCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const pool = await stockPool(asset.mint);
      const data = await read(
        `pools/${pool}/ohlcv/minute?aggregate=1&limit=1&currency=usd&token=base&before_timestamp=${minute + 59}`,
      );
      const high = stockCandleHigh(data, asset.mint, minute);
      if (high === null) candleCache.delete(key);
      return high;
    } catch {
      candleCache.delete(key);
      return null;
    }
  })();
  if (candleCache.size >= 2000)
    candleCache.delete(candleCache.keys().next().value!);
  candleCache.set(key, pending);
  return pending;
}
