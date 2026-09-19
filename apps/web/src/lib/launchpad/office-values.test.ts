import { expect, it } from "vitest";
import { feeUsdTotals } from "./office-values";
it("aggregates native fees using raw-token USD references", () => {
  expect(
    feeUsdTotals(
      [
        { symbol: "SOL", revenue: "2", creatorPayouts: "1" },
        { symbol: "NVDAX", revenue: "0.5", creatorPayouts: "0.2" },
      ],
      { SOL: 100, NVDAX: 200 },
    ),
  ).toEqual({ revenue: 300, creatorPayouts: 140, complete: true });
});
it("does not call unpriced balances zero", () => {
  expect(
    feeUsdTotals([{ symbol: "MET", revenue: "2", creatorPayouts: "1" }], null),
  ).toEqual({ revenue: null, creatorPayouts: null, complete: false });
  expect(feeUsdTotals([], null)).toEqual({
    revenue: 0,
    creatorPayouts: 0,
    complete: true,
  });
});
