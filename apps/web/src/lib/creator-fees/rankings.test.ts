import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  creatorFeeProfiles,
  creatorFeePools,
  creatorFeeAllocations,
  creatorFeeBalanceSnapshots,
  launchTokens,
  poolSnapshots,
} from "@oneonly/db";
import { creatorRankings } from "./rankings";
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const options = {
  network: "devnet",
  query: "",
  offset: 0,
  sort: "fees" as const,
  prices: { SOL: { mint: "sol", usd: 100 }, USDC: { mint: "usdc", usd: 1 } },
};
async function token(
  xId: string,
  earned: number | null,
  config: {
    network?: string;
    status?: string;
    quote?: string;
    pending?: number;
    claimed?: number;
    mint?: string;
  } = {},
) {
  const id = randomUUID(),
    quote = config.quote ?? "SOL",
    decimals = quote === "SOL" ? 9 : 6;
  await local.db.insert(launchTokens).values({
    id,
    network: config.network ?? "devnet",
    status: config.status ?? "active",
    ticker: "TEST",
    name: "Test",
    description: "",
    imageId: randomUUID(),
    creator: "wallet",
    quote,
    quoteMint: quote.toLowerCase(),
    quoteDecimals: decimals,
    mint: id,
    pool: id,
    config: "config",
  });
  await local.db.insert(poolSnapshots).values({
    tokenId: id,
    priceQuote: "0.01",
    marketCapQuote: "10",
    quoteReserve: "1",
    progress: 1,
    creatorQuoteFee: "0",
  });
  await local.db.insert(creatorFeePools).values({
    tokenId: id,
    network: config.network ?? "devnet",
    pool: id,
    mint: id,
    escrow: id,
    program: "program",
  });
  await local.db
    .insert(creatorFeeAllocations)
    .values({ tokenId: id, xId, shareBps: 10000 });
  if (earned !== null)
    await local.db.insert(creatorFeeBalanceSnapshots).values({
      tokenId: id,
      xId,
      observedAt: new Date(),
      balances: [
        {
          mint: config.mint ?? quote.toLowerCase(),
          symbol: quote,
          decimals,
          amountAtomic: String(earned - (config.claimed ?? 0)),
          claimedAtomic: String(config.claimed ?? 0),
          totalEntitlementAtomic: String(earned),
          pendingAtomic: String(config.pending ?? 0),
          pendingVenue: "dbc",
        },
      ],
    });
  return id;
}
beforeAll(async () => {
  local = await createLocalDatabase();
  await local.db.insert(creatorFeeProfiles).values(
    Array.from({ length: 28 }, (_, i) => ({
      xId: String(i + 1),
      username: `creator${i + 1}`,
      name: `Creator ${i + 1}`,
    })),
  );
  await token("1", 1_000_000_000, { claimed: 998_000_000 });
  await token("2", 60_000_000, { quote: "USDC" });
  await token("2", 60_000_000, { quote: "USDC" });
  await token("3", null);
  await token("4", 999_000_000_000, { network: "mainnet-beta" });
  await token("4", 999_000_000_000, { status: "draft" });
  await token("5", 0);
  await token("6", 100, { mint: "unknown" });
  for (let i = 7; i <= 28; i++) await token(String(i), i * 1_000_000);
}, 30_000);
afterAll(async () => local.client.close());
it("ranks earned fees across assets before pagination, preserving claimed earnings", async () => {
  const result = await creatorRankings(local.db, options);
  expect(result.creators).toHaveLength(24);
  expect(result.hasMore).toBe(true);
  expect(result.creators.slice(0, 2).map((r) => [r.xId, r.feesUsd])).toEqual([
    ["2", 120],
    ["1", 100],
  ]);
  expect(result.creators[1].balances).toEqual([
    {
      mint: "sol",
      symbol: "SOL",
      decimals: 9,
      amountAtomic: "2000000",
      earnedAtomic: "1000000000",
      pendingAtomic: "0",
    },
  ]);
  expect(result.creators.some((r) => r.xId === "4")).toBe(false);
  const tail = await creatorRankings(local.db, { ...options, offset: 24 });
  expect(tail.hasMore).toBe(false);
  expect(tail.creators.map((r) => r.xId)).toEqual(["5", "3", "6"]);
  expect(tail.creators[0].feesUsd).toBe(0);
  expect(tail.creators[1].feesUsd).toBeNull();
  expect(tail.creators[2].feesUsd).toBeNull();
  expect(tail.creators[0].rank).toBe(25);
});
it("ranks token popularity, supports handle search, and never treats unknown prices as zero", async () => {
  const result = await creatorRankings(local.db, {
    ...options,
    sort: "tokens",
  });
  expect(result.creators[0].xId).toBe("2");
  expect(result.creators[0].tokenCount).toBe(2);
  const searched = await creatorRankings(local.db, {
    ...options,
    query: "@creator1",
    prices: {},
  });
  expect(searched.creators.every((r) => r.feesUsd === null)).toBe(true);
  expect(searched.creators.some((r) => r.xId === "1")).toBe(true);
});
it("new pending earnings accumulate while previously paid amounts stay out of claimable totals", async () => {
  await token("1", 500_000, { pending: 1_500_000 });
  const result = await creatorRankings(local.db, {
    ...options,
    query: "Creator 1",
  });
  const row = result.creators.find((r) => r.xId === "1")!;
  expect(row.balances?.[0].amountAtomic).toBe("2500000");
  expect(row.balances?.[0].pendingAtomic).toBe("1500000");
  expect(row.feesUsd).toBeCloseTo(100.2);
});
