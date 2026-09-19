import { expect, it } from "vitest";
import { scaledFields, snapshotQuoteFields } from "./display-units";
it("adjusts displayed quotes without mutating stored accounting or curve progress", () => {
  const raw = {
    priceQuote: "0.00001",
    marketCapQuote: "10000",
    quoteReserve: "14",
    creatorQuoteFee: "0.04",
    progress: 50,
  };
  expect(scaledFields(raw, snapshotQuoteFields, 1.25)).toEqual({
    priceQuote: "0.0000125",
    marketCapQuote: "12500",
    quoteReserve: "17.5",
    creatorQuoteFee: "0.05",
    progress: 50,
  });
  expect(raw.quoteReserve).toBe("14");
});
