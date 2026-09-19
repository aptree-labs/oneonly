import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ time: vi.fn(), genesis: vi.fn() }));
vi.mock("@solana/web3.js", () => ({
  Connection: class {
    getGenesisHash = mock.genesis;
    getBlockTime = mock.time;
  },
}));
vi.mock("@oneonly/protocol", () => ({
  quoteAssets: () => [
    { symbol: "SOL", mint: "sol", decimals: 9 },
    { symbol: "USDC", mint: "usdc", decimals: 6 },
    { symbol: "JUP", mint: "jup", referenceMint: "jup", decimals: 6 },
  ],
  MAINNET_STOCKS: [],
  inspectStockSetup: vi.fn(),
  USDC_MINTS: { "mainnet-beta": "usdc" },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});
it("keeps other assets priced when Coinbase fails and coalesces fresh requests", async () => {
  const { GENESIS_HASHES } = await import("@oneonly/core");
  mock.genesis.mockResolvedValue(GENESIS_HASHES["mainnet-beta"]);
  mock.time.mockResolvedValue(Math.floor(Date.now() / 1000));
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("coinbase")) throw new Error("Feed down");
    return Response.json({
      sol: { usdPrice: 100, decimals: 9, blockId: 100 },
      jup: { usdPrice: 0.2, decimals: 6, blockId: 100 },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const { prices } = await import("./price");
  const [first, second] = await Promise.all([prices(), prices()]);
  expect(first).toMatchObject({ SOL: 100, JUP: 0.2 });
  expect(first.USDC).toBeUndefined();
  expect(second).toBe(first);
  expect(await prices()).toBe(first);
  expect(mock.time).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("rejects stale Jupiter prices and falls back independently for SOL and USDC", async () => {
  const { GENESIS_HASHES } = await import("@oneonly/core");
  mock.genesis.mockResolvedValue(GENESIS_HASHES["mainnet-beta"]);
  mock.time.mockResolvedValue(Math.floor(Date.now() / 1000) - 600);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("coinbase")
        ? Response.json({
            data: {
              base: url.includes("SOL-USD") ? "SOL" : "USDC",
              amount: url.includes("SOL-USD") ? "99" : "0.999",
            },
          })
        : Response.json({ jup: { usdPrice: 0.2, decimals: 6, blockId: 100 } }),
    ),
  );
  const { prices } = await import("./price");
  expect(await prices()).toMatchObject({ SOL: 99, USDC: 0.999 });
  expect((await prices()).JUP).toBeUndefined();
});
