import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  launchTokens,
  poolSnapshots,
  tokenTrades,
  officeTotals,
} from "./index";
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const now = new Date("2026-09-16T12:00:00Z");
const activatedAt = new Date("2026-09-01T12:00:00Z");
const rows = ["active", "released", "draft", "failed", "active"].map(
  (status, i) => ({
    id: randomUUID(),
    network: i === 4 ? "devnet" : "mainnet-beta",
    status,
    ticker: `OFFICE${i}`,
    name: "Office fixture",
    description: "Fixture",
    imageId: randomUUID(),
    creator: "owner",
    quote: "SOL",
    quoteMint: "sol-mint",
    quoteDecimals: 9,
    mint: `mint-${i}`,
    pool: `pool-${i}`,
    config: "config",
    activatedAt,
  }),
);
beforeAll(async () => {
  local = await createLocalDatabase();
  await local.db.insert(launchTokens).values(rows);
  await local.db.insert(poolSnapshots).values(
    rows.map((row, i) => ({
      tokenId: row.id,
      priceQuote: "1",
      marketCapQuote: "1",
      quoteReserve: "1",
      creatorQuoteFee: "0",
      progress: 100,
      readyToMigrate: true,
      graduated: i === 1,
      coverageStart: activatedAt,
      indexedThrough: now,
    })),
  );
  await local.db.insert(tokenTrades).values(
    rows.map((row, i) => ({
      tokenId: row.id,
      signature: `sig-${i}`,
      eventIndex: 0,
      wallet: "wallet",
      side: "buy",
      baseAmount: "1",
      quoteAmount: "2.5",
      priceQuote: "1",
      volumeUsd: i === 1 ? null : 250,
      blockTime: activatedAt,
    })),
  );
  await local.db
    .insert(tokenTrades)
    .values({
      tokenId: rows[0].id,
      signature: "future",
      eventIndex: 0,
      wallet: "wallet",
      side: "buy",
      baseAmount: "1",
      quoteAmount: "99",
      priceQuote: "1",
      volumeUsd: 9900,
      blockTime: new Date("2027-01-01"),
    });
});
afterAll(async () => {
  await local.client.close();
});
it("counts released launches, excludes drafts, failed and other networks; readiness is not graduation", async () => {
  const data = await officeTotals(local.db, "mainnet-beta", now);
  expect(data.launches).toBe(2);
  expect(data.graduations).toBe(1);
  expect(data.trades).toBe(2);
  expect(data.volumes[0].amount).toBe("5.0");
  expect(data.volumeUsd).toBe(250);
  expect(data.unpricedTrades).toBe(1);
  expect(data.volumeComplete).toBe(false);
  expect(data.coveredPools).toBe(1); // Migrated pool has no completed DAMM history scan.
});
it("keeps true empty data separate from incomplete history", async () => {
  const empty = await officeTotals(local.db, "empty-network", now);
  expect(empty.launches).toBe(0);
  expect(empty.volumeUsd).toBe(0);
  expect(empty.volumeComplete).toBe(true);
  const complete = await officeTotals(local.db, "devnet", now);
  expect(complete.volumeComplete).toBe(true);
  expect(complete.volumeUsd).toBe(250);
});
