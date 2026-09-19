import { PLATFORM_TOKEN_MINT } from "@oneonly/core";
import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  launchTokens,
  poolSnapshots,
  tokenTrades,
  marketListings,
  marketCandles,
} from "./index";
const now = new Date("2026-09-12T12:00:00Z");
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const tokens = Array.from({ length: 105 }, (_, i) => ({
  id: randomUUID(),
  network: "devnet",
  ticker: `TEST${i}`,
  name: `Test ${i}`,
  description: "Isolated market query fixture",
  imageId: randomUUID(),
  creator: "test-wallet",
  quote: i === 1 ? "USDC" : "SOL",
  mint: `contract-address-${i}`,
  pool: `pool-${i}`,
  config: "test-config",
  status: "active",
  activatedAt: new Date(now.getTime() - (110 - i) * 86400000),
}));
const options = {
  network: "devnet",
  sort: "volume" as const,
  pair: "All" as const,
  search: "",
  page: 0,
  references: { SOL: 100, USDC: 1 },
  now,
};
beforeAll(async () => {
  local = await createLocalDatabase();
  await local.db.insert(launchTokens).values(tokens);
  await local.db.insert(poolSnapshots).values(
    tokens.map((token, i) => ({
      tokenId: token.id,
      priceQuote: "0.0000001",
      marketCapQuote: i === 0 ? "2" : i === 1 ? "150" : "1",
      quoteReserve: "1",
      progress: i === 3 ? 100 : 1,
      graduated: i === 3,
      creatorQuoteFee: "0",
      coverageStart: token.activatedAt,
      indexedThrough: now,
    })),
  );
  const trade = (
    index: number,
    signature: string,
    time: string,
    price: string,
    usd: number | null,
    volume = "2",
  ) => ({
    tokenId: tokens[index].id,
    signature,
    eventIndex: 0,
    wallet: "fixture",
    side: "buy",
    baseAmount: "1",
    quoteAmount: volume,
    priceQuote: price,
    volumeUsd: usd,
    blockTime: new Date(time),
  });
  await local.db
    .insert(tokenTrades)
    .values([
      trade(2, "a", "2026-09-12T11:00:01Z", "0.000000020", 100),
      trade(2, "b", "2026-09-12T11:00:02Z", "0.000000040", 100),
      trade(2, "c", "2026-09-12T11:00:02Z", "0.000000010", 100),
      trade(2, "d", "2026-09-12T11:00:59Z", "0.000000030", 100),
      trade(2, "e", "2026-09-12T11:03:00Z", "0.000000025", 100),
      trade(2, "ancient", "2026-08-01T11:00:00Z", "0.000000005", 50),
      trade(1, "old", "2026-09-11T11:59:59Z", "1", 10000),
      trade(1, "future", "2026-09-12T12:00:00Z", "1", 10000),
      trade(0, "boundary", "2026-09-11T12:00:00Z", "1", 5),
      trade(4, "unknown", "2026-09-12T11:01:00Z", "1", null),
    ]);
});
afterAll(async () => {
  await local.client.close();
});
it("ranks rolling 24h USD volume across all listings before paging, excluding old and future trades", async () => {
  const result = await marketListings(local.db, options);
  expect(result.total).toBe(105);
  expect(result.tokens).toHaveLength(24);
  expect(result.tokens[0].id).toBe(tokens[2].id);
  expect(result.tokens[0].volumeUsd24h).toBe(500);
  expect(result.tokens[0].volumeComplete).toBe(true);
  expect(result.tokens[1].id).toBe(tokens[0].id);
  expect(result.tokens[1].volumeUsd24h).toBe(5);
  const last = await marketListings(local.db, { ...options, page: 4 });
  expect(
    last.tokens.find((token) => token.id === tokens[4].id)?.volumeUsd24h,
  ).toBeNull();
});
it("compares SOL and USDC caps in USD, searches full contracts, and retains graduated listings without stale DAMM values", async () => {
  const caps = await marketListings(local.db, {
    ...options,
    sort: "market-cap",
  });
  expect(caps.tokens.slice(0, 2).map((token) => token.id)).toEqual([
    tokens[0].id,
    tokens[1].id,
  ]);
  expect(caps.tokens[0].marketCapUsd).toBe(200);
  const search = await marketListings(local.db, {
    ...options,
    search: "contract-address-3",
  });
  const graduated = search.tokens.find((token) => token.id === tokens[3].id)!;
  expect(graduated.snapshot?.graduated).toBe(true);
  expect(graduated.marketCapUsd).toBeNull();
  expect(graduated.volumeUsd24h).toBeNull();
  const newest = await marketListings(local.db, { ...options, sort: "newest" });
  expect(newest.tokens[0].id).toBe(tokens[104].id);
  const usdc = await marketListings(local.db, { ...options, pair: "USDC" });
  expect(usdc.total).toBe(1);
  expect(usdc.tokens[0].volumeUsd24h).toBe(0);
  const unpriced = await marketListings(local.db, {
    ...options,
    references: null,
  });
  expect(unpriced.tokens.every((token) => token.marketCapUsd === null)).toBe(
    true,
  );
  expect(
    (await marketListings(local.db, { ...options, search: "%" })).total,
  ).toBe(0);
});
it("builds precise OHLCV buckets without fabricating empty minutes and pages older history", async () => {
  const history = await marketCandles(local.db, tokens[2].id, "1m");
  expect(history.candles).toHaveLength(2);
  const first = history.candles[0];
  expect(first.time).toBe(Date.parse("2026-09-12T11:00:00Z") / 1000);
  expect([first.open, first.high, first.low, first.close].map(Number)).toEqual([
    2e-8, 4e-8, 1e-8, 3e-8,
  ]);
  expect(Number(first.volume)).toBe(8);
  expect(first.trades).toBe(4);
  expect(history.hasMore).toBe(true);
  const earlier = await marketCandles(
    local.db,
    tokens[2].id,
    "1m",
    history.from!,
  );
  expect(earlier.candles).toHaveLength(1);
  expect(Number(earlier.candles[0].close)).toBe(5e-9);
  expect(earlier.hasMore).toBe(false);
  const hourly = await marketCandles(local.db, tokens[2].id, "1h");
  expect(hourly.candles).toHaveLength(1);
  expect(Number(hourly.candles[0].close)).toBe(2.5e-8);
  expect(Number(hourly.candles[0].volume)).toBe(10);
  expect(
    (await marketCandles(local.db, tokens[100].id, "15m")).candles,
  ).toEqual([]);
});

it("search ranks exact tickers and contracts ahead of partial matches, and treats SQL wildcards literally", async () => {
  const exact = await marketListings(local.db, {
    ...options,
    sort: "relevance",
    search: "$TEST1",
  });
  expect(exact.tokens[0].id).toBe(tokens[1].id);
  const contract = await marketListings(local.db, {
    ...options,
    sort: "relevance",
    search: "contract-address-10",
  });
  expect(contract.tokens[0].id).toBe(tokens[10].id);
  const literal = await marketListings(local.db, { ...options, search: "%_" });
  expect(literal.total).toBe(0);
});
it("search age filters apply before pagination and oldest reverses launch order", async () => {
  const recent = await marketListings(local.db, {
    ...options,
    age: "7d",
    sort: "newest",
  });
  expect(recent.total).toBe(2);
  expect(recent.tokens.map((token) => token.id)).toEqual([
    tokens[104].id,
    tokens[103].id,
  ]);
  expect(
    (await marketListings(local.db, { ...options, age: "24h" })).total,
  ).toBe(0);
  const oldest = await marketListings(local.db, { ...options, sort: "oldest" });
  expect(oldest.tokens[0].id).toBe(tokens[0].id);
});
it("stock search can narrow a category to one asset without leaking other pairs", async () => {
  const fixtures = ["SPYX", "QQQX"].map((quote, i) => ({
    ...tokens[0],
    id: randomUUID(),
    ticker: `STOCK${i}`,
    mint: `stock-mint-${i}`,
    pool: `stock-pool-${i}`,
    network: "stock-search-fixture",
    quote,
    quoteCategory: "Stocks",
  }));
  await local.db.insert(launchTokens).values(fixtures);
  const all = await marketListings(local.db, {
    ...options,
    network: "stock-search-fixture",
    pair: "Stocks",
  });
  expect(all.total).toBe(2);
  const specific = await marketListings(local.db, {
    ...options,
    network: "stock-search-fixture",
    pair: "SPYX",
  });
  expect(specific.total).toBe(1);
  expect(specific.tokens[0].id).toBe(fixtures[0].id);
});

it("sorts actual recent buys ahead of untouched launches", async () => {
  const rows = await marketListings(local.db, {
    ...options,
    sort: "recent-buys",
  });
  expect(rows.tokens[0].id).toBe(tokens[1].id);
  expect(rows.tokens[1].id).toBe(tokens[2].id);
});
it("USD candles use recorded execution values and omit missing prices", async () => {
  const result = await marketCandles(
    local.db,
    tokens[2].id,
    "1m",
    undefined,
    "usd",
  );
  expect(Number(result.candles[0].close)).toBe(100);
  expect(Number(result.candles[0].volume)).toBe(400);
  expect(
    (await marketCandles(local.db, tokens[4].id, "1m", undefined, "usd"))
      .candles,
  ).toEqual([]);
});

it("pins the official mainnet mint ahead of sorting before pagination", async () => {
  const official = { ...tokens[0], id: randomUUID(), network: "mainnet-beta", mint: PLATFORM_TOKEN_MINT, pool: "official-pool", ticker: "ONEONLY", activatedAt: new Date("2025-01-01") };
  const others = Array.from({ length: 25 }, (_, i) => ({ ...tokens[0], id: randomUUID(), network: "mainnet-beta", mint: `other-mainnet-${i}`, pool: `other-pool-${i}`, ticker: `OTHER${i}`, activatedAt: now }));
  await local.db.insert(launchTokens).values([official, ...others]);
  for (const sort of ["newest", "volume", "market-cap", "recent-buys"] as const) {
    const first = await marketListings(local.db, { ...options, network: "mainnet-beta", sort });
    const second = await marketListings(local.db, { ...options, network: "mainnet-beta", sort, page: 1 });
    expect(first.tokens[0].id).toBe(official.id);
    expect(first.total).toBe(26);
    expect(second.tokens.some((t) => t.id === official.id)).toBe(false);
  }
  const search = await marketListings(local.db, { ...options, network: "mainnet-beta", search: "OTHER" });
  expect(search.tokens.some((t) => t.id === official.id)).toBe(false);
});

it("keeps verified graduated volume visible while a newer trade awaits its historical price", async () => {
  const network = "partial-volume-fixture";
  const fixture = {
    ...tokens[0],
    id: randomUUID(),
    network,
    ticker: "PARTIAL",
    mint: "partial-volume-mint",
    pool: "partial-volume-pool",
    activatedAt: new Date(now.getTime() - 86400000),
  };
  await local.db.insert(launchTokens).values(fixture);
  await local.db.insert(poolSnapshots).values({
    tokenId: fixture.id,
    priceQuote: "1",
    marketCapQuote: "100",
    quoteReserve: "2",
    progress: 100,
    graduated: true,
    marketVenue: "damm-v2",
    creatorQuoteFee: "0",
    coverageStart: fixture.activatedAt,
    indexedThrough: now,
  });
  const trade = {
    tokenId: fixture.id,
    eventIndex: 0,
    venue: "damm-v2",
    wallet: "fixture",
    side: "buy",
    baseAmount: "1",
    quoteAmount: "2",
    priceQuote: "2",
    blockTime: new Date(now.getTime() - 1000),
  };
  await local.db.insert(tokenTrades).values([
    { ...trade, signature: "partial-priced", volumeUsd: 200 },
    { ...trade, signature: "partial-unpriced", volumeUsd: null },
    {
      ...trade,
      signature: "partial-old",
      volumeUsd: 9999,
      blockTime: new Date(now.getTime() - 86400001),
    },
  ]);
  const row = (await marketListings(local.db, { ...options, network }))
    .tokens[0];
  expect(row.volumeUsd24h).toBe(200);
  expect(row.volumeUnpricedTrades).toBe(1);
  expect(row.volumeComplete).toBe(false);
});
it("does not turn entirely unpriced trades into zero volume or complete history", async () => {
  const result = await marketListings(local.db, {
    ...options,
    search: tokens[4].mint,
  });
  const row = result.tokens.find((token) => token.id === tokens[4].id)!;
  expect(row.volumeUsd24h).toBeNull();
  expect(row.volumeUnpricedTrades).toBe(1);
  expect(row.volumeComplete).toBe(false);
});

it("does not mark a mixed-price subtotal complete even with fully indexed curve history", async () => {
  await local.db.insert(tokenTrades).values({
    tokenId: tokens[4].id, signature: "mixed-curve-priced", eventIndex: 0,
    wallet: "fixture", side: "buy", baseAmount: "1", quoteAmount: "2",
    priceQuote: "2", volumeUsd: 200, blockTime: new Date(now.getTime() - 1000),
  });
  const result = await marketListings(local.db, { ...options, search: tokens[4].mint });
  const row = result.tokens.find((token) => token.id === tokens[4].id)!;
  expect(row.volumeUsd24h).toBe(200);
  expect(row.volumeUnpricedTrades).toBe(1);
  expect(row.volumeComplete).toBe(false);
});
