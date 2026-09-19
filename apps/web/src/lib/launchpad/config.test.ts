import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ configuredPool: vi.fn() }));
vi.mock("@oneonly/protocol", () => ({
  NETWORK: "mainnet-beta",
  quoteAssets: () => ["SOL", "USDC", "JUP", "MET"].map(symbol => ({ symbol, config: symbol + "config" })),
  configuredPool: mocks.configuredPool,
  quoteMultiplier: async () => 1,
}));
vi.mock("./price", () => ({ prices: async () => ({ SOL: 100, USDC: 1, JUP: .2, MET: .2 }) }));
it("coalesces simultaneous config reads and bounds verification concurrency", async () => {
  let active = 0, maxActive = 0;
  mocks.configuredPool.mockImplementation(async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
  });
  const { appConfig } = await import("./config");
  const [a,b] = await Promise.all([appConfig(), appConfig()]);
  expect(a).toBe(b);
  expect(mocks.configuredPool).toHaveBeenCalledTimes(4);
  expect(maxActive).toBe(2);
  expect(a.quotes.every(q => q.creationEnabled && q.enabled)).toBe(true);
  expect(await appConfig()).toBe(a);
  expect(mocks.configuredPool).toHaveBeenCalledTimes(4);
});
