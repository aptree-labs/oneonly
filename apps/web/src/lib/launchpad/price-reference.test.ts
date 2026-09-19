import { describe, expect, it } from "vitest";
import { rawUsdReference } from "./price-reference";

describe("stock price accounting units", () => {
  const scaled = {
    usdPrice: 100,
    decimals: 8,
    blockId: 1000,
    scaledUiConfig: {
      multiplier: 1,
      newMultiplier: 1.25,
      newMultiplierEffectiveAt: "2026-01-01T00:00:00Z",
      usdPricePrescaled: 125,
    },
  };
  it("values raw reserves with the prescaled price", () => {
    expect(rawUsdReference(scaled, 8, 1.25, Date.UTC(2026, 8))).toEqual({
      usd: 125,
      block: 1000,
    });
    expect(
      rawUsdReference({ usdPrice: 100, decimals: 8, blockId: 1000 }, 8),
    ).toEqual({ usd: 100, block: 1000 });
  });
  it("rejects stale multipliers and ambiguous or inconsistent scaling", () => {
    expect(rawUsdReference(scaled, 8, 1.5)).toBeNull();
    expect(
      rawUsdReference({ ...scaled, scaledUiConfig: undefined }, 8, 1.25),
    ).toBeNull();
    expect(
      rawUsdReference(
        {
          ...scaled,
          scaledUiConfig: { ...scaled.scaledUiConfig, usdPricePrescaled: 100 },
        },
        8,
        1.25,
      ),
    ).toBeNull();
  });
  it("rejects corrupt references instead of fabricating a USD value", () => {
    for (const value of [
      null,
      {},
      { usdPrice: NaN, decimals: 8, blockId: 1 },
      { usdPrice: 1, decimals: 6, blockId: 1 },
      { usdPrice: 1, decimals: 8, blockId: -1 },
    ])
      expect(rawUsdReference(value, 8)).toBeNull();
  });
});
