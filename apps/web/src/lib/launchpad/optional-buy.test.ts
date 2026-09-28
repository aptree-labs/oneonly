import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createLaunch: vi.fn(),
  prices: vi.fn(),
  conversion: vi.fn(),
  balance: vi.fn(),
  simulation: vi.fn(),
  intents: {} as object,
  values: [] as Record<string, any>[],
}));
vi.mock("@oneonly/db", () => {
  const table = {};
  const tx = {
    insert: (target: object) => ({
      values: (value: Record<string, any>) => {
        if (target === mocks.intents) mocks.values.push(value);
        return {
          returning: async () => [
            { id: "intent", status: "prepared", ...value },
          ],
          onConflictDoNothing: () => ({
            returning: async () => [{ id: "claim" }],
          }),
        };
      },
    }),
    delete: () => ({ where: async () => {} }),
  };
  return {
    launchTokens: table,
    tickerClaims: {},
    tokenImages: {},
    transactionIntents: mocks.intents,
    eq: vi.fn(),
    and: vi.fn(),
    desc: vi.fn(),
    getDatabase: async () => ({
      ...tx,
      select: () => ({
        from: () => ({ where: async () => [{ id: "image" }] }),
      }),
      transaction: async (fn: any) => fn(tx),
    }),
  };
});
vi.mock("@oneonly/protocol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oneonly/protocol")>()),
  assertNetwork: async () => {},
  quoteAssets: () => [{ symbol: "SOL" }, { symbol: "USDC" }],
  quoteAsset: (symbol: string) => ({
    symbol,
    decimals: symbol === "SOL" ? 9 : 6,
    mint: "mint",
    category: symbol,
  }),
  quoteMultiplier: async () => 1,
  createLaunch: mocks.createLaunch,
  connection: () => ({
    getBalance: mocks.balance,
    getLatestBlockhash: async () => ({
      blockhash: "hash",
      lastValidBlockHeight: 123,
    }),
  }),
  prepareTransactionWire: () => ({
    wire: "wire",
    message: "message",
    priorityFeeLamports: null,
  }),
}));
vi.mock("./auth", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
  rateLimit: async () => {},
  origin: () => "https://app.oneonly.lol",
  string: String,
}));
vi.mock("./launch-simulation", () => ({
  validateLaunchSimulation: mocks.simulation,
}));
vi.mock("./price", () => ({ prices: mocks.prices }));
vi.mock("./launch-conversion", () => ({ launchConversion: mocks.conversion }));
import { launch } from "./transactions";
const input = {
  ticker: "ONLY",
  name: "Only token",
  description: "A token with an optional initial buy",
  imageId: "00000000-0000-4000-8000-000000000001",
  quote: "SOL",
  payment: "SOL",
  slippageBps: 100,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.values.length = 0;
  mocks.balance.mockResolvedValue(100_000_000);
  mocks.simulation.mockReset().mockResolvedValue(undefined);
  mocks.createLaunch.mockResolvedValue({
    transaction: {},
    pool: "pool",
    config: "config",
    minimumOut: "1000000",
  });
  mocks.prices.mockResolvedValue({ SOL: 100, USDC: 1, timestamp: Date.now() });
});
it.each(["SOL", "USDC"])(
  "creates a %s pool without buying, requesting prices, or converting SOL",
  async (quote) => {
    await launch("11111111111111111111111111111111", { ...input, quote });
    expect(mocks.createLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ quote, amount: 0n }),
    );
    expect(mocks.prices).not.toHaveBeenCalled();
    expect(mocks.conversion).not.toHaveBeenCalled();
    expect(mocks.values[0].details.firstBuy).toContain("anyone");
    expect(mocks.values[0].details).not.toHaveProperty("minimumOutput");
  },
);
it("preserves the optional $5 minimum and existing atomic first-buy preparation", async () => {
  await expect(
    launch("11111111111111111111111111111111", {
      ...input,
      initialBuy: "0.01",
    }),
  ).rejects.toThrow("at least $5");
  expect(mocks.createLaunch).not.toHaveBeenCalled();
  await launch("11111111111111111111111111111111", {
    ...input,
    initialBuy: "0.05",
  });
  expect(mocks.createLaunch).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 50_000_000n }),
  );
  expect(mocks.values[0].details.input).toBe("0.05 SOL");
  expect(mocks.values[0].details).not.toHaveProperty("firstBuy");
});

it("rejects an unfunded launch before creating a pool or pending intent", async () => {
  mocks.balance.mockResolvedValue(0);
  await expect(
    launch("11111111111111111111111111111111", input),
  ).rejects.toThrow(/has no .* SOL/);
  expect(mocks.createLaunch).not.toHaveBeenCalled();
  expect(mocks.values).toHaveLength(0);
});

it("does not return an approval intent when a funded launch fails simulation", async () => {
  mocks.balance.mockResolvedValue(1_000_000);
  mocks.simulation.mockRejectedValue(
    new Error("Not enough SOL for creation rent"),
  );
  await expect(
    launch("11111111111111111111111111111111", input),
  ).rejects.toThrow("Not enough SOL");
  expect(mocks.simulation).toHaveBeenCalledOnce();
  expect(mocks.values).toHaveLength(0);
});
