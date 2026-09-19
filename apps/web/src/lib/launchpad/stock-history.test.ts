import { expect, it } from "vitest";
import { stockCandleHigh } from "./stock-history";
import { USDC_MINTS, MAINNET_STOCKS } from "@oneonly/protocol";
const mint = MAINNET_STOCKS[0].mint;
const data = {
  meta: {
    base: { address: mint },
    quote: { address: USDC_MINTS["mainnet-beta"] },
  },
  data: { attributes: { ohlcv_list: [[120, 760, 767, 759, 766, 10]] } },
};
it("uses the exact stock mint, USDC pair and minute high for conservative history", () => {
  expect(stockCandleHigh(data, mint, 120)).toBe(767);
});
it("keeps gaps and wrong assets unknown rather than releasing their ticker", () => {
  expect(stockCandleHigh(data, mint, 180)).toBeNull();
  expect(stockCandleHigh(data, MAINNET_STOCKS[1].mint, 120)).toBeNull();
  expect(
    stockCandleHigh(
      { ...data, meta: { base: { address: mint }, quote: { address: mint } } },
      mint,
      120,
    ),
  ).toBeNull();
  expect(
    stockCandleHigh(
      {
        ...data,
        data: { attributes: { ohlcv_list: [[120, 760, 750, 759, 766, 10]] } },
      },
      mint,
      120,
    ),
  ).toBeNull();
});
