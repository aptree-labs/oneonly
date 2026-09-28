import { expect, it } from "vitest";
import {
  createPrefill,
  createTickerHref,
  createCreatorHref,
} from "./create-prefill";
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
  expect(createTickerHref("a*b", "USDC")).toBeNull();
  expect(createTickerHref("12345678901", "MET")).toBeNull();
});
it("never offers to create the reserved platform brand or look-alikes", () => {
  for (const ticker of ["ONEONLY", "1only", "10nly", "ONEONLY2", "ONLYONE", "ONLY1", "0NLY0NE"])
    expect(createTickerHref(ticker, "JUP")).toBeNull();
});

it("encodes ticker punctuation and carries only a validated creator ID", () => {
  const link = new URL(
    createTickerHref("A+B?/<>", "SOL")!,
    "https://oneonly.lol",
  );
  expect(link.searchParams.get("ticker")).toBe("A+B?/<>");
  expect(createCreatorHref("123", "JUP")).toBe(
    "/app/create?creator=123&quote=JUP",
  );
  expect(createCreatorHref("@someone")).toBeNull();
});
