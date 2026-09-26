import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  creatorFeeProfiles,
  creatorFeePools,
  creatorFeeBalanceSnapshots,
  type Database,
} from "@oneonly/db";
vi.mock("./balances", () => ({ readCreatorFeeBalances: vi.fn() }));
vi.mock("./runtime", () => ({ creatorFeeRuntime: vi.fn() }));
import { recipientFeeTotals, refreshFeeSnapshot } from "./projections";
import { readCreatorFeeBalances } from "./balances";
let db: Database, close: () => Promise<void>;
beforeAll(async () => {
  const local = await createLocalDatabase();
  db = local.db;
  close = () => local.client.close();
}, 30_000);
afterAll(async () => close());
const balance = (mint: string, amountAtomic: string, pendingAtomic = "0") => ({
  mint,
  symbol: mint,
  decimals: 9,
  amountAtomic,
  pendingAtomic,
  claimedAtomic: "0",
  totalEntitlementAtomic: amountAtomic,
  pendingVenue: "dbc" as const,
});
it("aggregates integer units by mint and reports stale/incomplete coverage without inventing zeros", async () => {
  await db
    .insert(creatorFeeProfiles)
    .values({ xId: "700", username: "someone", name: "Someone" });
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids)
    await db.insert(creatorFeePools).values({
      tokenId: id,
      network: "devnet",
      pool: id,
      mint: "mint",
      escrow: "escrow",
      program: "program",
    });
  await db.insert(creatorFeeBalanceSnapshots).values([
    {
      tokenId: ids[0],
      xId: "700",
      balances: [
        balance("SOL", "9007199254740993", "8"),
        balance("USDC", "25"),
      ],
      observedAt: new Date(),
    },
    {
      tokenId: ids[1],
      xId: "700",
      balances: [balance("SOL", "7", "2")],
      observedAt: new Date(Date.now() - 300000),
    },
    { tokenId: ids[2], xId: "700", balances: [], observedAt: null },
  ]);
  const [result] = await recipientFeeTotals(["700"], db);
  expect(result.observedTokens).toBe(2);
  expect(result.freshTokens).toBe(1);
  expect(result.lastUpdated).toBeTruthy();
  expect(result.balances).toEqual([
    {
      mint: "SOL",
      symbol: "SOL",
      decimals: 9,
      amountAtomic: "9007199254741000",
      pendingAtomic: "10",
    },
    {
      mint: "USDC",
      symbol: "USDC",
      decimals: 9,
      amountAtomic: "25",
      pendingAtomic: "0",
    },
  ]);
  await db
    .insert(creatorFeeProfiles)
    .values({ xId: "701", username: "newuser", name: "New User" });
  const [unknown] = await recipientFeeTotals(["701"], db);
  expect(unknown.balances).toBeNull();
  expect(unknown.observedTokens).toBe(0);
});
it("preserves last known balances and observation time during a provider outage", async () => {
  const id = randomUUID();
  await db.insert(creatorFeePools).values({
    tokenId: id,
    network: "devnet",
    pool: id,
    mint: "mint",
    escrow: "escrow",
    program: "program",
  });
  await db
    .insert(creatorFeeProfiles)
    .values({ xId: "702", username: "retry", name: "Retry" });
  vi.mocked(readCreatorFeeBalances).mockResolvedValue([balance("SOL", "100")]);
  const initial = await refreshFeeSnapshot(id, "702", db);
  vi.mocked(readCreatorFeeBalances).mockRejectedValue(
    new Error("RPC unavailable"),
  );
  await expect(refreshFeeSnapshot(id, "702", db)).rejects.toThrow(
    "RPC unavailable",
  );
  const [result] = await recipientFeeTotals(["702"], db);
  expect(result.balances?.[0].amountAtomic).toBe("100");
  expect(new Date(result.lastUpdated!).toISOString()).toBe(initial.observedAt);
});
