import { expect, it } from "vitest";
import { createPrefill, createTickerHref } from "./create-prefill";
it("carries ticker and exact paired asset into the creation URL", () => {
  expect(createTickerHref(" $giddy2 ", "JUP")).toBe(
    "/app/create?ticker=GIDDY2&quote=JUP",
  );
  expect(createPrefill("ABCDE", "NVDAX")).toEqual({
    ticker: "ABCDE",
    quote: "NVDAX",
  });
});
it("does not interpret category filters, addresses or free text as launch parameters", () => {
  expect(createPrefill("GIDDY", "Stocks").quote).toBe("SOL");
  expect(createTickerHref("a very long name", "SOL")).toBeNull();
  expect(createTickerHref("<script>", "USDC")).toBeNull();
  expect(createTickerHref("12345678901", "MET")).toBeNull();
});
