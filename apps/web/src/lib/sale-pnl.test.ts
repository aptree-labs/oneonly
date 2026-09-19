import { expect, it } from "vitest";
import { saleCostBasis, saleReturn, type CostTrade } from "./sale-pnl";
const trade = (
  signature: string,
  side: string,
  baseAmount: string,
  quoteAmount: string,
  time: number,
): CostTrade => ({
  signature,
  side,
  baseAmount,
  quoteAmount,
  blockTime: new Date(time * 1000),
});
const sale = {
  signature: "sale",
  quantity: 25_000_000n,
  preBalance: 100_000_000n,
  quoteDecimals: 9,
};
it("uses the average acquisition cost for a partial sale, not the full investment", () => {
  const rows = [
    trade("buy1", "buy", "50", "1", 1),
    trade("buy2", "buy", "50", "3", 2),
    trade("sale", "sell", "25", "1.5", 3),
  ];
  const cost = saleCostBasis(rows, sale);
  expect(cost).toBe(1_000_000_000n);
  expect(saleReturn(1_500_000_000n, cost!, 9)).toEqual({
    costBasis: "1",
    pnl: "0.5",
    percent: 50,
  });
});
it("removes cost consumed by previous sales and supports a later buy", () => {
  const rows = [
    trade("buy1", "buy", "100", "4", 1),
    trade("sell1", "sell", "50", "8", 2),
    trade("buy2", "buy", "50", "6", 3),
    trade("sale", "sell", "25", "1", 4),
  ];
  expect(saleCostBasis(rows, sale)).toBe(2_000_000_000n);
  expect(saleReturn(1_000_000_000n, 2_000_000_000n, 9)).toEqual({
    costBasis: "2",
    pnl: "-1",
    percent: -50,
  });
  expect(saleReturn(500_000_000n, 750_000_000n, 9).pnl).toBe("-0.25");
});
it("does not invent cost basis for transfers, missing buys, or ambiguous ordering", () => {
  const rows = [
    trade("buy", "buy", "100", "4", 1),
    trade("sale", "sell", "25", "1", 2),
  ];
  expect(saleCostBasis(rows, { ...sale, preBalance: 120_000_000n })).toBeNull();
  expect(saleCostBasis(rows.slice(1), sale)).toBeNull();
  expect(
    saleCostBasis(
      [rows[0], { ...rows[1], blockTime: rows[0].blockTime }],
      sale,
    ),
  ).toBeNull();
  expect(saleCostBasis(rows, { ...sale, signature: "other" })).toBeNull();
});
it("handles zero, small values and complete exits without floating point token arithmetic", () => {
  expect(saleReturn(10n, 0n, 6)).toEqual({
    costBasis: "0",
    pnl: "0.00001",
    percent: null,
  });
  const rows = [
    trade("buy", "buy", "0.000003", "0.000007", 1),
    trade("sell1", "sell", "0.000001", "0.000004", 2),
    trade("sale", "sell", "0.000002", "0.000005", 3),
  ];
  expect(
    saleCostBasis(rows, {
      ...sale,
      preBalance: 2n,
      quantity: 2n,
      quoteDecimals: 6,
    }),
  ).toBe(5n);
  expect(saleReturn(5n, 5n, 6).percent).toBe(0);
});
