import { PLATFORM_TOKEN_MINT } from "@oneonly/core";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  launchTokens,
  poolSnapshots,
  tokenTrades,
  graduatedIndexes,
} from "./schema";
import type { Database } from "./index";

export type MarketSort =
  "volume" | "recent-buys" | "market-cap" | "newest" | "oldest" | "relevance";
export type MarketPair =
  | "All"
  | "SOL"
  | "Stocks"
  | "USDC"
  | "Tokens"
  | "JUP"
  | "MET"
  | "SPYX"
  | "QQQX"
  | "NVDAX"
  | "TSLAX"
  | "CRCLX";
export const candleIntervals = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
} as const;
export type CandleInterval = keyof typeof candleIntervals;

export async function marketListings(
  db: Database,
  options: {
    network: string;
    sort: MarketSort;
    pair: MarketPair;
    search: string;
    age?: "All" | "24h" | "7d";
    page: number;
    references: Record<string, number> | null;
    quoteMints?: Record<string, string>;
    now?: Date;
  },
) {
  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - 86400000);
  const volume = db
    .select({
      tokenId: tokenTrades.tokenId,
      usd: sql<string>`sum(${tokenTrades.volumeUsd}::numeric)`.as("usd"),
      unknown:
        sql<number>`count(*) filter (where ${tokenTrades.volumeUsd} is null)`.as(
          "unknown",
        ),
    })
    .from(tokenTrades)
    .where(
      and(gte(tokenTrades.blockTime, start), lt(tokenTrades.blockTime, now)),
    )
    .groupBy(tokenTrades.tokenId)
    .as("volume");
  const referenceCases = Object.entries(options.references ?? {})
    .filter(
      ([symbol, value]) =>
        symbol !== "timestamp" && Number.isFinite(value) && value > 0,
    )
    .map(
      ([symbol, value]) =>
        sql`when ${launchTokens.quote} = ${symbol} and (${launchTokens.quoteMint} is null or ${launchTokens.quoteMint} = ${options.quoteMints?.[symbol] ?? null}) then ${value}::numeric`,
    );
  const reference = referenceCases.length
    ? sql`case ${sql.join(referenceCases, sql` `)} end`
    : sql`null::numeric`;
  // Only matching mints with current reference prices participate in USD ranking.
  const marketCapUsd = sql<
    number | null
  >`case when (${poolSnapshots.graduated} = false or ${poolSnapshots.marketVenue} = 'damm-v2') then
    ${poolSnapshots.marketCapQuote}::numeric * ${reference} end`;
  const volumeUsd24h = sql<
    number | null
  >`case when ${poolSnapshots.tokenId} is not null
    and (${poolSnapshots.graduated} = false or ${poolSnapshots.marketVenue} = 'damm-v2') and coalesce(${volume.unknown}, 0) = 0
    then coalesce(${volume.usd}, 0)::numeric end`;
  const term = options.search.trim().replace(/^\$/, "").toLowerCase();
  const pair =
    options.pair === "All"
      ? undefined
      : options.pair === "Stocks"
        ? eq(launchTokens.quoteCategory, "Stocks")
        : options.pair === "Tokens"
          ? sql`${launchTokens.quote} not in ('SOL', 'USDC') and coalesce(${launchTokens.quoteCategory}, 'Tokens') = 'Tokens'`
          : eq(launchTokens.quote, options.pair);
  const relevance = sql`case
    when lower(${launchTokens.mint}) = ${term} then 0
    when lower(${launchTokens.ticker}) = ${term} then 1
    when lower(${launchTokens.name}) = ${term} then 2
    when strpos(lower(${launchTokens.ticker}), ${term}) = 1 then 3
    when strpos(lower(${launchTokens.name}), ${term}) = 1 then 4
    else 5 end`;
  const recentBuy = sql`(select max(t.block_time) from token_trades t where t.token_id = ${launchTokens.id} and t.side = 'buy')`;
  const ordering =
    options.sort === "recent-buys"
      ? sql`${recentBuy} desc nulls last`
      : options.sort === "relevance" && term
        ? relevance
        : options.sort === "oldest"
          ? asc(launchTokens.activatedAt)
          : options.sort === "newest"
            ? desc(launchTokens.activatedAt)
            : sql`${options.sort === "volume" ? volumeUsd24h : marketCapUsd} desc nulls last`;
  const rows = await db
    .select({
      token: launchTokens,
      snapshot: poolSnapshots,
      marketCapUsd: marketCapUsd.mapWith(Number),
      volumeUsd24h: volumeUsd24h.mapWith(Number),
      total: sql<number>`count(*) over()`.mapWith(Number),
      graduatedIndex: graduatedIndexes,
    })
    .from(launchTokens)
    .leftJoin(poolSnapshots, eq(poolSnapshots.tokenId, launchTokens.id))
    .leftJoin(volume, eq(volume.tokenId, launchTokens.id))
    .leftJoin(graduatedIndexes, eq(graduatedIndexes.tokenId, launchTokens.id))
    .where(
      and(
        eq(launchTokens.network, options.network),
        eq(launchTokens.status, "active"),
        pair,
        options.age && options.age !== "All"
          ? gte(
              launchTokens.activatedAt,
              new Date(
                now.getTime() - (options.age === "24h" ? 1 : 7) * 86400000,
              ),
            )
          : undefined,
        term
          ? sql`strpos(lower(${launchTokens.ticker} || ' ' || ${launchTokens.name} || ' ' || ${launchTokens.mint}), ${term}) > 0`
          : undefined,
      ),
    )
    .orderBy(
      sql`case when ${launchTokens.network} = 'mainnet-beta' and ${launchTokens.mint} = ${PLATFORM_TOKEN_MINT} then 0 else 1 end`,
      ordering,
      sql`${marketCapUsd} desc nulls last`,
      desc(launchTokens.activatedAt),
      launchTokens.id,
    )
    .limit(24)
    .offset(options.page * 24);
  return {
    tokens: rows.map(
      ({ token, snapshot, marketCapUsd, volumeUsd24h, graduatedIndex }) => ({
        ...token,
        snapshot,
        marketCapUsd,
        volumeUsd24h,
        volumeComplete:
          !!snapshot &&
          (!snapshot.graduated ||
            (!!graduatedIndex?.coverageStart &&
              !!graduatedIndex.indexedThrough &&
              graduatedIndex.indexedThrough.getTime() >=
                now.getTime() - 10 * 60000 &&
              !!snapshot.indexedThrough &&
              snapshot.indexedThrough >= graduatedIndex.coverageStart)) &&
          volumeUsd24h !== null &&
          !!snapshot.coverageStart &&
          snapshot.coverageStart <=
            new Date(
              Math.max(
                start.getTime(),
                (token.activatedAt ?? token.createdAt).getTime(),
              ),
            ) &&
          !!snapshot.indexedThrough &&
          snapshot.indexedThrough.getTime() >= now.getTime() - 10 * 60000,
      }),
    ),
    total: rows[0]?.total ?? 0,
    page: options.page,
    pageSize: 24,
    asOf: now.toISOString(),
  };
}

export async function marketCandles(
  db: Database,
  tokenId: string,
  interval: CandleInterval,
  before?: number,
  currency: "quote" | "usd" = "quote",
) {
  const seconds = candleIntervals[interval];
  // Anchor to the latest indexed trade so inactive tokens still have inspectable history.
  const [latest] = await db
    .select({ time: tokenTrades.blockTime })
    .from(tokenTrades)
    .where(
      and(
        eq(tokenTrades.tokenId, tokenId),
        before === undefined
          ? undefined
          : lt(tokenTrades.blockTime, new Date(before * 1000)),
      ),
    )
    .orderBy(desc(tokenTrades.blockTime))
    .limit(1);
  if (!latest)
    return { candles: [], hasMore: false, from: null, through: null };
  const end =
    (Math.floor(latest.time.getTime() / 1000 / seconds) + 1) * seconds;
  const start = end - 500 * seconds;
  const bucket = sql<number>`floor(extract(epoch from ${tokenTrades.blockTime}) / ${seconds}::integer) * ${seconds}::integer`;
  const phase = sql`case ${tokenTrades.venue} when 'dbc' then 0 else 1 end`;
  const chronological = sql`${tokenTrades.blockTime}, ${tokenTrades.signature}, ${phase}, ${tokenTrades.eventIndex}`;
  const reversed = sql`${tokenTrades.blockTime} desc, ${tokenTrades.signature} desc, ${phase} desc, ${tokenTrades.eventIndex} desc`;
  const tradePrice =
    currency === "usd"
      ? sql`${tokenTrades.volumeUsd}::numeric / nullif(${tokenTrades.baseAmount}::numeric, 0)`
      : sql`${tokenTrades.priceQuote}::numeric`;
  const tradeVolume =
    currency === "usd"
      ? sql`${tokenTrades.volumeUsd}::numeric`
      : sql`${tokenTrades.quoteAmount}::numeric`;
  const candles = await db
    .select({
      time: bucket.mapWith(Number).as("time_bucket"),
      open: sql<string>`(array_agg(${tradePrice} order by ${chronological}))[1]`,
      high: sql<string>`max(${tradePrice})`,
      low: sql<string>`min(${tradePrice})`,
      close: sql<string>`(array_agg(${tradePrice} order by ${reversed}))[1]`,
      volume: sql<string>`sum(${tradeVolume})`,
      trades: sql<number>`count(*)`.mapWith(Number),
    })
    .from(tokenTrades)
    .where(
      and(
        eq(tokenTrades.tokenId, tokenId),
        gte(tokenTrades.blockTime, new Date(start * 1000)),
        lt(tokenTrades.blockTime, new Date(end * 1000)),
        sql`${tradePrice} > 0`,
      ),
    )
    .groupBy(sql`time_bucket`)
    .orderBy(sql`time_bucket`);
  const [older] = await db
    .select({ id: tokenTrades.id })
    .from(tokenTrades)
    .where(
      and(
        eq(tokenTrades.tokenId, tokenId),
        lt(tokenTrades.blockTime, new Date(start * 1000)),
      ),
    )
    .limit(1);
  return {
    candles,
    hasMore: !!older,
    from: start,
    through: latest.time.toISOString(),
  };
}
