import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  launchTokens,
  tokenTrades,
  walletProfiles,
  traderLeaderboard,
} from "./index";
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const now = new Date("2026-09-24T12:00:00Z");
const tokens = ["active", "released", "draft", "failed", "active"].map(
  (status, i) => ({
    id: randomUUID(),
    network: i === 4 ? "devnet" : "mainnet-beta",
    status,
    ticker: `RANK${i}`,
    name: "Rank fixture",
    description: "",
    imageId: randomUUID(),
    creator: "creator",
    quote: "SOL",
    quoteMint: "sol",
    quoteDecimals: 9,
    mint: `mint-${i}`,
    pool: `pool-${i}`,
    config: "config",
  }),
);
beforeAll(async () => {
  local = await createLocalDatabase();
  await local.db.insert(launchTokens).values(tokens);
  let seq = 0;
  async function trade(
    wallet: string,
    usd: number | null,
    hoursAgo = 1,
    token = 0,
    side = "buy",
    venue = "dbc",
  ) {
    await local.db.insert(tokenTrades).values({
      tokenId: tokens[token].id,
      signature: `sig-${++seq}`,
      eventIndex: 0,
      wallet,
      side,
      venue,
      volumeUsd: usd,
      baseAmount: "1",
      quoteAmount: "1",
      priceQuote: "1",
      blockTime: new Date(now.getTime() - hoursAgo * 3_600_000),
    });
  }
  await trade("alice", 100);
  await trade("alice", 50, 1, 1, "sell", "damm-v2");
  await trade("alice", null);
  await trade("alice", 9999, -1);
  await trade("alice", 9999, 0);
  await trade("bob", 150);
  await trade("bob", 200, 24);
  await trade("bob", 300, 168);
  await trade("carol", 900, 169);
  await trade("unpriced", null);
  await trade("invalid", -10);
  await trade("", 9999);
  await trade("draft", 9999, 1, 2);
  await trade("failed", 9999, 1, 3);
  await trade("devnet", 500, 1, 4);
  await trade("invalid-side", 900, 1, 0, "other");
  await local.db.insert(walletProfiles).values({
    wallet: "alice",
    xId: "private-x-id",
    xUsername: "alice_x",
    xAvatar: "https://example.com/avatar.jpg",
  });
});
afterAll(async () => {
  await local.client.close();
});
it("ranks priced, confirmed trades across venues and launched statuses, isolated by network", async () => {
  const result = await traderLeaderboard(
    local.db,
    "mainnet-beta",
    "24h",
    now,
    true,
  );
  expect(result.totalTraders).toBe(2);
  expect(result.traders.map((row) => row.wallet)).toEqual(["bob", "alice"]);
  expect(result.traders[1]).toMatchObject({
    rank: 2,
    volumeUsd: 150,
    trades: 2,
    buys: 1,
    sells: 1,
    tokens: 2,
    profile: { username: "alice_x" },
  });
  expect(JSON.stringify(result)).not.toContain("private-x-id");
  expect(result.traders[0].volumeUsd).toBe(350); // exact 24-hour boundary included
  expect(
    (await traderLeaderboard(local.db, "devnet", "24h", now)).traders[0].wallet,
  ).toBe("devnet");
});
it("uses rolling periods including their start, excluding now/future, and lifetime history", async () => {
  const week = await traderLeaderboard(local.db, "mainnet-beta", "7d", now);
  expect(week.traders[0].volumeUsd).toBe(650);
  expect(week.traders.map((row) => row.wallet)).not.toContain("carol");
  const all = await traderLeaderboard(local.db, "mainnet-beta", "all", now);
  expect(all.traders[0].wallet).toBe("carol");
  expect(all.traders.every((row) => row.profile === null)).toBe(true);
  expect(
    (await traderLeaderboard(local.db, "empty", "all", now)).traders,
  ).toEqual([]);
});
it("bounds results at 100, preserves total count, and deterministically orders ties", async () => {
  await local.db.insert(tokenTrades).values(
    Array.from({ length: 105 }, (_, i) => ({
      tokenId: tokens[4].id,
      signature: `bounded-${i}`,
      eventIndex: 0,
      wallet: `wallet-${String(i).padStart(3, "0")}`,
      side: "buy",
      volumeUsd: 1,
      baseAmount: "1",
      quoteAmount: "1",
      priceQuote: "1",
      blockTime: new Date(now.getTime() - 1000),
    })),
  );
  const result = await traderLeaderboard(local.db, "devnet", "all", now);
  expect(result.totalTraders).toBe(106);
  expect(result.traders).toHaveLength(100);
  expect(result.traders[1].wallet).toBe("wallet-000");
  expect(result.traders[99].rank).toBe(100);
});
