import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  creatorFeeProfiles,
  creatorFeeBindings,
  creatorFeeChallenges,
  creatorFeeAllocations,
  walletProfiles,
  eq,
  type Database,
} from "@oneonly/db";
vi.mock("./runtime", () => ({
  creatorFeeRuntime: vi.fn().mockRejectedValue(new Error("not deployed")),
}));
vi.mock("./balances", () => ({
  readCreatorFeeBalances: vi.fn().mockRejectedValue(new Error("not deployed")),
}));
vi.mock("@oneonly/protocol", () => ({ client: vi.fn(), PublicKey: class {} }));
vi.mock("./provider", async (original) => ({
  ...(await original<typeof import("./provider")>()),
  verifyXPost: vi
    .fn()
    .mockResolvedValue({ tweetId: "888888", publishedAt: new Date() }),
}));
import {
  feeDashboard,
  createFeeChallenge,
  bindFeeWallet,
  claimScopeHash,
  recordFeeAllocation,
  verifyFeeChallenge,
  verifiedFeeChallenge,
  resolveFeeAllocation,
} from "./service";
let db: Database, close: () => Promise<void>;
beforeAll(async () => {
  const local = await createLocalDatabase();
  db = local.db;
  close = () => local.client.close();
}, 30_000);
afterAll(async () => {
  await close();
});
afterEach(() => vi.unstubAllEnvs());
function enable() {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  vi.stubEnv("SOLANA_NETWORK", "devnet");
}
async function seed(xId: string, wallet: string) {
  await db
    .insert(creatorFeeProfiles)
    .values({ xId, username: `user${xId}`, name: `User ${xId}` });
  await db
    .insert(walletProfiles)
    .values({ wallet, xId, xUsername: `user${xId}` });
}
it("makes bindings immutable even after mutable social profile changes", async () => {
  enable();
  await seed("101", "wallet1");
  await seed("102", "wallet2");
  const results = await Promise.all([
    bindFeeWallet("wallet1", db),
    bindFeeWallet("wallet1", db),
  ]);
  expect(results.map((r) => r.wallet)).toEqual(["wallet1", "wallet1"]);
  await db.delete(walletProfiles).where(eq(walletProfiles.wallet, "wallet1"));
  await db
    .update(walletProfiles)
    .set({ xId: "101" })
    .where(eq(walletProfiles.wallet, "wallet2"));
  await expect(bindFeeWallet("wallet2", db)).rejects.toThrow("already bound");
  const rows = await db
    .select()
    .from(creatorFeeBindings)
    .where(eq(creatorFeeBindings.xId, "101"));
  expect(rows).toHaveLength(1);
  expect(rows[0].wallet).toBe("wallet1");
});
it("records allocation atomically, idempotently, and rejects changed shares", async () => {
  enable();
  await seed("201", "wallet201");
  await seed("202", "wallet202");
  const data = {
    tokenId: randomUUID(),
    network: "devnet" as const,
    pool: "pool201",
    mint: "mint201",
    escrow: "escrow201",
    program: "program201",
    recipients: [
      { xId: "201", shareBps: 6000 },
      { xId: "202", shareBps: 4000 },
    ],
  };
  await Promise.all([
    recordFeeAllocation(data, db),
    recordFeeAllocation(data, db),
  ]);
  await expect(
    recordFeeAllocation(
      {
        ...data,
        recipients: [
          { xId: "201", shareBps: 5000 },
          { xId: "202", shareBps: 5000 },
        ],
      },
      db,
    ),
  ).rejects.toThrow("immutable");
  expect(
    (
      await db
        .select()
        .from(creatorFeeAllocations)
        .where(eq(creatorFeeAllocations.tokenId, data.tokenId))
    )
      .map((r) => r.shareBps)
      .sort(),
  ).toEqual([4000, 6000]);
  await expect(
    resolveFeeAllocation([{ xId: "999", shareBps: 10000 }], db),
  ).rejects.toThrow("Look up");
});
it("atomically rejects concurrent verification and reused post evidence, without marking a payout", async () => {
  enable();
  await seed("301", "wallet301");
  await bindFeeWallet("wallet301", db);
  const tokenId = randomUUID();
  await recordFeeAllocation(
    {
      tokenId,
      network: "devnet",
      pool: "pool301",
      mint: "mint",
      escrow: "escrow",
      program: "program",
      recipients: [{ xId: "301", shareBps: 10000 }],
    },
    db,
  );
  const scope = {
    tokenId,
    network: "devnet",
    xId: "301",
    wallet: "wallet301",
    bindingVersion: 1,
    mint: "mint",
    amountAtomic: "100",
    cumulativeAtomic: "100",
    program: "program",
    escrow: "escrow",
  };
  const id = randomUUID();
  const row = {
    ...scope,
    id,
    code: "code301",
    scopeHash: claimScopeHash(scope),
    createdAt: new Date(Date.now() - 10000),
    expiresAt: new Date(Date.now() + 60000),
  };
  await db.insert(creatorFeeChallenges).values(row);
  const results = await Promise.allSettled([
    verifyFeeChallenge("wallet301", id, "https://x.com/u/status/888888", db),
    verifyFeeChallenge("wallet301", id, "https://x.com/u/status/888888", db),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const verified = await verifiedFeeChallenge("wallet301", id, db);
  expect(verified.status).toBe("verified");
  expect(verified.confirmedSignature).toBeNull();
  const id2 = randomUUID();
  await db
    .insert(creatorFeeChallenges)
    .values({ ...row, id: id2, code: "code302" });
  await expect(
    verifyFeeChallenge("wallet301", id2, "https://x.com/u/status/888888", db),
  ).rejects.toThrow("already been used");
  await expect(verifiedFeeChallenge("wallet2", id, db)).rejects.toThrow();
  await db
    .update(creatorFeeChallenges)
    .set({ amountAtomic: "999" })
    .where(eq(creatorFeeChallenges.id, id));
  await expect(verifiedFeeChallenge("wallet301", id, db)).rejects.toThrow(
    "fresh post",
  );
});
it("fails closed outside staging devnet", async () => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  await expect(bindFeeWallet("wallet1", db)).rejects.toThrow("devnet preview");
});

import { creatorFeeRuntime } from "./runtime";
import { readCreatorFeeBalances } from "./balances";
import { client } from "@oneonly/protocol";
it("checks authoritative balances before asking for a post and freezes the cumulative cap", async () => {
  enable();
  vi.stubEnv("CREATOR_FEE_PROGRAM_ID", "program401");
  vi.mocked(creatorFeeRuntime).mockResolvedValue({
    program: {} as never,
    verifier: {} as never,
  });
  vi.mocked(client).mockReturnValue({
    state: {
      getPool: vi.fn().mockResolvedValue({
        poolState: { creator: { toBase58: () => "escrow401" } },
      }),
    },
  } as never);
  vi.mocked(readCreatorFeeBalances).mockResolvedValue([
    {
      mint: "mint401",
      symbol: "SOL",
      decimals: 9,
      amountAtomic: "200",
      pendingAtomic: "300",
      pendingVenue: "dbc",
      claimedAtomic: "50",
      totalEntitlementAtomic: "250",
    },
  ]);
  await seed("401", "wallet401");
  await bindFeeWallet("wallet401", db);
  const tokenId = randomUUID();
  await recordFeeAllocation(
    {
      tokenId,
      network: "devnet",
      pool: "pool401",
      mint: "mint401",
      escrow: "escrow401",
      program: "program401",
      recipients: [{ xId: "401", shareBps: 10000 }],
    },
    db,
  );
  await expect(
    createFeeChallenge(
      "wallet401",
      { tokenId, mint: "mint401", amountAtomic: "201" },
      db,
    ),
  ).rejects.toThrow("exceeds");
  await expect(
    createFeeChallenge(
      "wallet401",
      { tokenId, mint: "other", amountAtomic: "1" },
      db,
    ),
  ).rejects.toThrow("exceeds");
  const issued = await createFeeChallenge(
    "wallet401",
    { tokenId, mint: "mint401", amountAtomic: "100" },
    db,
  );
  const [row] = await db
    .select()
    .from(creatorFeeChallenges)
    .where(eq(creatorFeeChallenges.id, issued.id));
  expect(row.cumulativeAtomic).toBe("150");
  expect(row.amountAtomic).toBe("100");
  expect(row.status).toBe("pending");
  expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(600_000);
  expect(row.scopeHash).not.toBe(
    claimScopeHash({ ...row, cumulativeAtomic: "151" }),
  );
});

it("distinguishes current OAuth profile from immutable financial beneficiary", async () => {
  enable();
  await seed("801", "wallet801");
  await bindFeeWallet("wallet801", db);
  await db
    .update(walletProfiles)
    .set({ xId: "802", xUsername: "newidentity" })
    .where(eq(walletProfiles.wallet, "wallet801"));
  const result = await feeDashboard("wallet801", db);
  expect(result.profile?.xId).toBe("801");
  expect(result.connectedProfile?.xId).toBe("802");
  expect(result.binding?.xId).toBe("801");
  expect(
    await resolveFeeAllocation([{ xId: "802", shareBps: 10000 }], db),
  ).toHaveLength(1);
});
