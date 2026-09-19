import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ totals: vi.fn(), fees: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("./price", () => ({ prices: async () => null }));
vi.mock("@oneonly/db", () => ({
  getDatabase: async () => ({}),
  officeTotals: mocks.totals,
}));
vi.mock("@oneonly/protocol", () => ({
  NETWORK: "mainnet-beta",
  client: () => ({ state: { getPoolFeeBreakdown: mocks.fees } }),
}));
import { readOfficeFees } from "./office";
const bn = (n: string) => ({
  isZero: () => BigInt(n) === 0n,
  toString: () => n,
});
const pool = (id: string) => ({
  pool: id,
  quote: "SOL",
  quoteMint: "sol-mint",
  quoteDecimals: 9,
});
beforeEach(() => {
  vi.resetAllMocks();
});
it("aggregates native earned revenue separately from claimed creator fees, preserving missing-pool coverage", async () => {
  mocks.totals.mockResolvedValue({
    launches: 3,
    graduations: 1,
    pools: [pool("a"), pool("b"), pool("c")],
  });
  mocks.fees.mockImplementation(async (id: string) => {
    if (id === "c") throw new Error("RPC unavailable");
    return {
      partner: { totalBaseFee: bn("0"), totalQuoteFee: bn("1000000000") },
      creator: {
        totalBaseFee: bn("0"),
        claimedQuoteFee: bn(id === "a" ? "500000000" : "-1"),
      },
    };
  });
  const data = await readOfficeFees();
  expect(data.checked).toBe(2);
  expect(data.pools).toBe(3);
  expect(data.graduated).toBe(1);
  expect(Number(data.assets[0].revenue)).toBe(2);
  expect(Number(data.assets[0].creatorPayouts)).toBe(0.5);
});
it("does not show zero when all pool reads fail", async () => {
  mocks.totals.mockResolvedValue({
    launches: 1,
    graduations: 0,
    pools: [pool("a")],
  });
  mocks.fees.mockRejectedValue(new Error("RPC unavailable"));
  const data = await readOfficeFees();
  expect(data.checked).toBe(0);
  expect(data.assets).toEqual([]);
});
