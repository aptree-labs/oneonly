import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  snapshot: {
    priceQuote: "2",
    marketCapQuote: "200",
    quoteReserve: "20",
    graduated: false,
    updatedAt: new Date(),
  },
  refresh: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("react", () => ({ cache: (fn: Function) => fn }));
vi.mock("./transactions", () => ({
  tokenById: async () => ({ id: "token", quote: "SOL", quoteMint: "sol" }),
}));
vi.mock("./indexer", () => ({ refreshSnapshot: mocks.refresh }));
vi.mock("./discovery", () => ({
  displayReferences: async () => ({ SOL: 100, timestamp: Date.now() }),
  invalidateDiscovery: mocks.invalidate,
}));
vi.mock("@oneonly/protocol", () => ({
  quoteAssets: () => [{ symbol: "SOL", mint: "sol" }],
  quoteMultiplier: async () => 1,
}));
vi.mock("@oneonly/db", () => ({
  poolSnapshots: { tokenId: "snapshot" },
  tokenTrades: { tokenId: "trade", blockTime: "time" },
  eq: vi.fn(),
  desc: vi.fn(),
  getDatabase: async () => ({
    select: () => ({
      from: (table: { tokenId: string }) => ({
        where: () => ({
          limit: async () => [mocks.snapshot],
          orderBy: () => ({
            limit: async () =>
              table.tokenId === "trade" ? [] : [mocks.snapshot],
          }),
        }),
      }),
    }),
  }),
}));
import { tokenDetail } from "./token-detail";
beforeEach(() => {
  vi.clearAllMocks();
});
it("renders saved public token details without a live pool RPC refresh", async () => {
  const result = await tokenDetail("token");
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(result.marketCapUsd).toBe(20000);
  expect(result.snapshot?.priceQuote).toBe("2");
  expect(typeof result.snapshot?.updatedAt).toBe("string");
});
it("keeps saved data marked stale when the live refresh fails", async () => {
  mocks.refresh.mockRejectedValue(new Error("RPC busy"));
  const result = await tokenDetail("token", true);
  expect(result.stale).toBe(true);
  expect(result.snapshot?.priceQuote).toBe("2");
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("coalesces concurrent pool reads without invalidating all discovery entries", async () => {
  mocks.refresh.mockResolvedValue({ ...mocks.snapshot, priceQuote: "3" });
  const results = await Promise.all([
    tokenDetail("token", true),
    tokenDetail("token", true),
  ]);
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(results.every((r) => r.snapshot?.priceQuote === "3" && !r.stale)).toBe(
    true,
  );
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
