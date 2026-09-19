import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ quote: vi.fn(), route: vi.fn() }));
vi.mock("./auth", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
  string: (value: unknown) => String(value),
}));
vi.mock("@oneonly/protocol", () => ({
  quoteAsset: (symbol: string) => {
    if (!["SOL", "USDC", "SPYX"].includes(symbol))
      throw new Error("Unsupported asset");
    return { decimals: symbol === "SOL" ? 9 : symbol === "USDC" ? 6 : 8 };
  },
  quoteMultiplier: async (symbol: string) => (symbol === "SPYX" ? 1.25 : 1),
  quoteSwap: state.quote,
}));
vi.mock("./routed-trade", () => ({ quoteRoutedSwap: state.route }));
import { tradePreview } from "./trade-preview";
const token = {
  pool: "pool",
  quote: "SPYX",
  ticker: "TEST",
  status: "active",
  quoteDecimals: 8,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.quote.mockResolvedValue({
    out: "2000000",
    minimumOut: "1900000",
    venue: "dbc",
  });
  state.route.mockResolvedValue({
    poolQuote: { out: "2000000", minimumOut: "1900000", venue: "dbc" },
    route: { out: 1100000n, minimumOut: 1000000n },
    settlement: { decimals: 8 },
    multiplier: 1.25,
  });
});
it("quotes direct stock input in raw units and returns token units", async () => {
  const result = await tradePreview(token, {
    side: "buy",
    settlement: "SPYX",
    amount: "0,0125",
    slippageBps: 100,
  });
  expect(state.quote).toHaveBeenCalledWith("pool", 1000000n, false, 100);
  expect(result).toMatchObject({
    output: "2",
    minimumOutput: "1.9",
    outputSymbol: "TEST",
  });
});
it("scales direct stock output for a sell", async () => {
  const result = await tradePreview(token, {
    side: "sell",
    settlement: "SPYX",
    amount: "2",
    slippageBps: 100,
  });
  expect(state.quote).toHaveBeenCalledWith("pool", 2000000n, true, 100);
  expect(result.output).toBe("0.025");
});
it("uses the shared routed quote for both directions without preparing an intent", async () => {
  const result = await tradePreview(
    { ...token, quote: "SOL" },
    { side: "sell", settlement: "SPYX", amount: "2", slippageBps: 100 },
  );
  expect(result).toMatchObject({
    output: "0.01375",
    minimumOutput: "0.0125",
    outputSymbol: "SPYX",
  });
  expect(result).not.toHaveProperty("transaction");
  const buy = await tradePreview(token, {
    side: "buy",
    settlement: "USDC",
    amount: "89",
    slippageBps: 100,
  });
  expect(buy.output).toBe("2");
});
it("rejects invalid amounts, unavailable tokens, sides and assets before quoting", async () => {
  const input = {
    side: "buy",
    settlement: "SPYX",
    amount: "1",
    slippageBps: 100,
  };
  for (const override of [
    { amount: "NaN" },
    { amount: "0" },
    { side: "other" },
    { settlement: "FAKE" },
    { slippageBps: 10001 },
  ])
    await expect(
      tradePreview(token, { ...input, ...override }),
    ).rejects.toThrow();
  await expect(
    tradePreview({ ...token, status: "draft" }, input),
  ).rejects.toThrow();
  expect(state.quote).not.toHaveBeenCalled();
  expect(state.route).not.toHaveBeenCalled();
});
