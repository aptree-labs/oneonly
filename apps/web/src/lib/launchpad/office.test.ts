import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ totals: vi.fn(), snapshot: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("./price", () => ({ prices: async () => null }));
vi.mock("@oneonly/db", () => ({
  getDatabase: async () => ({}),
  officeTotals: mocks.totals,
}));
vi.mock("@oneonly/protocol", () => ({ NETWORK: "mainnet-beta" }));
vi.mock("./office-fee-snapshot", () => ({
  readCurveFeeSnapshot: mocks.snapshot,
}));
import { readOfficeFees } from "./office";
const pool = (id: string) => ({
  id,
  pool: `pool-${id}`,
  config: "shared-config",
  quote: "SOL",
  quoteMint: "sol-mint",
  quoteDecimals: 9,
});
beforeEach(() => {
  vi.resetAllMocks();
});
it("aggregates complete snapshots with earned revenue separate from paid creator claims", async () => {
  const pools = [pool("a"), pool("b"), pool("c")];
  mocks.totals.mockResolvedValue({ launches: 3, graduations: 1, pools });
  // Rows deliberately arrive in another order: totals are matched by token id.
  // Unclaimed creator earnings are not creator payouts.
  mocks.snapshot.mockResolvedValue([
    { id: "c", revenue: 250000000n, creatorPayouts: 0n },
    { id: "a", revenue: 1000000000n, creatorPayouts: 500000000n },
    { id: "b", revenue: 1000000000n, creatorPayouts: 0n },
  ]);
  const data = await readOfficeFees();
  expect(mocks.snapshot).toHaveBeenCalledWith(pools);
  expect(data.checked).toBe(3);
  expect(data.pools).toBe(3);
  expect(data.graduated).toBe(1);
  expect(data.assets).toEqual([
    {
      symbol: "SOL",
      mint: "sol-mint",
      revenue: "2.25",
      creatorPayouts: "0.5",
    },
  ]);
  expect(data.usd).toEqual({
    revenue: null,
    creatorPayouts: null,
    complete: false,
  });
});
it.each([
  ["one account is unavailable", "A curve fee account is unavailable"],
  ["all RPC reads fail", "RPC unavailable"],
])("refuses a replacement total when %s", async (_scenario, message) => {
  mocks.totals.mockResolvedValue({
    launches: 3,
    graduations: 0,
    pools: [pool("a"), pool("b"), pool("c")],
  });
  mocks.snapshot.mockRejectedValue(new Error(message));
  // The snapshot reader rejects partial batches. Propagate that failure so the
  // cache can retain its last complete result, rather than publish less or zero.
  await expect(readOfficeFees()).rejects.toThrow(message);
});
