import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  launchTokens,
  poolSnapshots,
  tokenTrades,
  graduatedIndexes,
  apiLimits,
  eq,
} from "@oneonly/db";
import { VersionedMessage, PublicKey } from "@solana/web3.js";
import { BN, decodeTransactionEvents, versionOneEventReceipt } from "@oneonly/protocol";
import fixture from "../../../../../packages/protocol/src/fixtures/devnet-damm-buy.json";

import mainnetFixture from "../../../../../packages/protocol/src/fixtures/mainnet-damm-v1-swap.json";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const mock = vi.hoisted(() => ({
  rpc: {} as any,
  market: {} as any,
  historical: vi.fn().mockResolvedValue(100),
}));
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<typeof import("@oneonly/db")>()),
  getDatabase: async () => local.db,
}));
vi.mock("@oneonly/protocol", async (original) => ({
  ...(await original<typeof import("@oneonly/protocol")>()),
  assertNetwork: async () => {},
  connection: () => mock.rpc,
  tradingPool: async () => mock.market,
}));
vi.mock("./price", () => ({ historicalUsd: mock.historical }));
vi.mock("./history-rpc", async () => ({
  historyConnection: () => mock.rpc,
  readHistoryReceipt: async (rpc: any, signature: string) => (await import("@oneonly/protocol")).readEventReceipt(rpc, signature),
}));
import { claimIndexerLease } from "./indexer-lease";
import { refreshRecentTrades } from "./recent-indexer";
import { indexPool } from "./indexer";
import { indexGraduatedReceipt } from "./graduated-indexer";
const receipt = {
  blockTime: 1789849000,
  transaction: {
    message: VersionedMessage.deserialize(
      Buffer.from(fixture.message, "base64"),
    ),
  },
  meta: {
    err: null,
    logMessages: fixture.logMessages,
    innerInstructions: fixture.innerInstructions,
  },
} as any;
const pool = decodeTransactionEvents(receipt, "damm-v2")
  .find((e) => e.name === "evtSwap2")!
  .data.pool.toString();
let token: typeof launchTokens.$inferSelect;
beforeAll(async () => {
  local = await createLocalDatabase();
  [token] = await local.db
    .insert(launchTokens)
    .values({
      id: randomUUID(),
      network: "devnet",
      ticker: "EXTERNAL",
      name: "External",
      description: "",
      imageId: randomUUID(),
      creator: PublicKey.default.toBase58(),
      quote: "SOL",
      quoteDecimals: 9,
      mint: randomUUID(),
      pool: PublicKey.default.toBase58(),
      config: randomUUID(),
      status: "active",
      launchSignature: "missing-old-launch",
      activatedAt: new Date(1789800000000),
    })
    .returning();
  await local.db
    .insert(poolSnapshots)
    .values({
      tokenId: token.id,
      priceQuote: "1",
      marketCapQuote: "1",
      quoteReserve: "1",
      creatorQuoteFee: "0",
      progress: 100,
      graduated: true,
      dammPool: pool,
      scanBefore: "older-curve-page",
    });
  mock.market = {
    virtual: {
      poolState: {
        sqrtPrice: new BN("18446744073709551616"),
        quoteReserve: new BN(100000000),
        creatorQuoteFee: new BN(0),
        isMigrated: 1,
      },
    },
    config: { migrationQuoteThreshold: new BN(100000000) },
    state: {
      sqrtPrice: new BN("18446744073709551616"),
      tokenBVault: PublicKey.default,
    },
    address: new PublicKey(pool),
    readyToMigrate: false,
  };
});
beforeEach(async () => {
  await local.db.delete(apiLimits);
  await local.db.delete(tokenTrades);
  await local.db.delete(graduatedIndexes);
  mock.historical.mockReset().mockResolvedValue(100);
  mock.rpc = {
    getSlot: async () => 123,
    getBlockTime: async () => receipt.blockTime,
    getTokenAccountBalance: async () => ({ value: { amount: "100000000" } }),
    getSignaturesForAddress: vi.fn(async (address: PublicKey) =>
      address.toBase58() === pool
        ? [{ signature: "external-buy", err: null }]
        : [],
    ),
    getTransaction: vi.fn(async () => receipt),
  };
});
afterAll(async () => {
  await local.client.close();
});
it("allows only one worker across concurrent cache misses", async () => {
  const claims = await Promise.all(
    Array.from({ length: 12 }, () => claimIndexerLease("race", 45)),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
});
it("ingests an external graduated buy while curve backfill is unfinished, without moving history cursors", async () => {
  const runs = await Promise.all([
    refreshRecentTrades(),
    refreshRecentTrades(),
  ]);
  expect(runs.filter((r) => !r.skipped)).toHaveLength(1);
  const [trade] = await local.db.select().from(tokenTrades);
  expect(trade.venue).toBe("damm-v2");
  expect(trade.side).toBe("buy");
  expect(trade.volumeUsd).toBeGreaterThan(0);
  expect(mock.rpc.getTransaction).toHaveBeenCalledTimes(1);
  const [snapshot] = await local.db.select().from(poolSnapshots);
  expect(snapshot.scanBefore).toBe("older-curve-page");
  expect(snapshot.indexedThrough).toBeNull();
  expect(await local.db.select().from(graduatedIndexes)).toHaveLength(0);
});
it("runs graduated history even when the old launch boundary is unavailable", async () => {
  const result = await indexPool(token);
  expect(result.indexed).toBe(false);
  expect(result.reason).toContain("boundary");
  const trades = await local.db.select().from(tokenTrades);
  expect(trades).toHaveLength(1);
  expect(trades[0].venue).toBe("damm-v2");
});
it("persists native amounts during a price outage and replay enriches exactly once", async () => {
  mock.historical.mockResolvedValueOnce(null);
  await indexGraduatedReceipt(token, pool, "replayed-buy", receipt);
  const [native] = await local.db.select().from(tokenTrades);
  expect(Number(native.quoteAmount)).toBeGreaterThan(0);
  expect(native.volumeUsd).toBeNull();
  await indexGraduatedReceipt(token, pool, "replayed-buy", receipt);
  mock.historical.mockResolvedValueOnce(null);
  await indexGraduatedReceipt(token, pool, "replayed-buy", receipt);
  const trades = await local.db.select().from(tokenTrades);
  expect(trades).toHaveLength(1);
  expect(trades[0].volumeUsd).toBeGreaterThan(0);
});
it("ignores failed receipts instead of adding fabricated turnover", async () => {
  await expect(
    indexGraduatedReceipt(token, pool, "failed", {
      ...receipt,
      meta: { ...receipt.meta, err: { failed: true } },
    }),
  ).rejects.toThrow("Incomplete");
  expect(await local.db.select().from(tokenTrades)).toHaveLength(0);
});

it("indexes a real external mainnet version-1 DAMM swap", async () => {
  const receipt = versionOneEventReceipt(mainnetFixture.receipt, mainnetFixture.signature);
  const result = await indexGraduatedReceipt(token, "6fVxZPKh7rScX2H9kDH2rVXSuzXL1bq2d3Mbpo82Sq1d", mainnetFixture.signature, receipt);
  expect(result.matched).toBe(true);
  const [trade] = await local.db.select().from(tokenTrades);
  expect(trade.venue).toBe("damm-v2");
  expect(Number(trade.quoteAmount)).toBeGreaterThan(0);
});
