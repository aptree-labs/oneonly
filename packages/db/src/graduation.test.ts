import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  launchTokens,
  poolSnapshots,
  graduatedIndexes,
  tokenTrades,
  marketListings,
  marketCandles,
} from "./index";

it("combines venues without deduplicating separate trades and requires graduated coverage", async () => {
  const { db, client } = await createLocalDatabase();
  try {
    const id = randomUUID(),
      now = new Date("2026-09-12T12:00:00Z"),
      activatedAt = new Date("2026-09-01T12:00:00Z");
    await db.insert(launchTokens).values({
      id,
      network: "devnet",
      ticker: "TEST",
      name: "Stock fixture",
      description: "Fixture",
      imageId: randomUUID(),
      creator: "fixture",
      mint: "base-mint",
      pool: "original-pool",
      config: "config",
      quote: "STOCK8",
      quoteMint: "stock-mint",
      quoteDecimals: 8,
      quoteCategory: "Stocks",
      status: "active",
      activatedAt,
    });
    await db.insert(poolSnapshots).values({
      tokenId: id,
      priceQuote: "0.1",
      marketCapQuote: "100",
      quoteReserve: "20",
      progress: 100,
      graduated: true,
      marketVenue: "damm-v2",
      dammPool: "graduated-pool",
      creatorQuoteFee: "0",
      coverageStart: activatedAt,
      indexedThrough: now,
    });
    const trade = {
      tokenId: id,
      signature: "same-transaction",
      eventIndex: 0,
      wallet: "fixture",
      side: "buy",
      baseAmount: "10",
      quoteAmount: "1",
      priceQuote: "0.1",
      volumeUsd: 20,
      blockTime: new Date("2026-09-12T11:30:00Z"),
    };
    await db.insert(tokenTrades).values([
      { ...trade, venue: "dbc" },
      { ...trade, venue: "damm-v2", priceQuote: "0.2" },
    ]);
    const options = {
      network: "devnet",
      sort: "volume" as const,
      pair: "Stocks" as const,
      search: "",
      page: 0,
      references: { SOL: 100, USDC: 1, STOCK8: 20 },
      quoteMints: { STOCK8: "stock-mint" },
      now,
    };
    let result = await marketListings(db, options);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].marketCapUsd).toBe(2000);
    expect(result.tokens[0].volumeUsd24h).toBe(40);
    expect(result.tokens[0].volumeComplete).toBe(false);
    await db.insert(graduatedIndexes).values({
      tokenId: id,
      pool: "graduated-pool",
      coverageStart: new Date("2026-09-11T12:00:00Z"),
      indexedThrough: now,
    });
    result = await marketListings(db, options);
    expect(result.tokens[0].volumeComplete).toBe(true);
    expect(
      (
        await marketListings(db, {
          ...options,
          quoteMints: { STOCK8: "changed-mint" },
        })
      ).tokens[0].marketCapUsd,
    ).toBeNull();
    expect(
      (await marketListings(db, { ...options, pair: "Tokens" })).tokens,
    ).toHaveLength(0);
    const candles = await marketCandles(db, id, "1m");
    expect(candles.candles).toHaveLength(1);
    expect(candles.candles[0].trades).toBe(2);
    expect(Number(candles.candles[0].volume)).toBe(2);
  } finally {
    await client.close();
  }
});
