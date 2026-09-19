import { expect, it } from "vitest";
import { marketValue } from "./market-value";

it("values every supported quote in USD using unscaled pool units", () => {
  for (const [symbol, usd] of Object.entries({
    SOL: 100,
    USDC: 0.9999,
    JUP: 0.22,
    MET: 0.2,
    SPYX: 755,
    QQQX: 706,
    NVDAX: 214,
    TSLAX: 365,
    CRCLX: 81,
  })) {
    const asset = { symbol, mint: symbol + "mint" };
    expect(
      marketValue(
        { quote: symbol, quoteMint: asset.mint },
        { marketCapQuote: "100", graduated: false },
        { [symbol]: usd },
        [asset],
      ),
    ).toBe(100 * usd);
  }
  // A 1.25 stock scale is already included in USD per raw quote token.
  expect(
    marketValue(
      { quote: "SPYX" },
      { marketCapQuote: "100", graduated: false },
      { SPYX: 125 },
      [{ symbol: "SPYX", mint: "mint" }],
    ),
  ).toBe(12500);
});
it("never substitutes zero for unknown pricing or values the wrong mint/venue", () => {
  const token = { quote: "SOL", quoteMint: "mint" };
  const pool = { marketCapQuote: "100", graduated: false };
  const assets = [{ symbol: "SOL", mint: "mint" }];
  const invalid: (Record<string, number> | null)[] = [null, {}, { SOL: NaN }, { SOL: 0 }, { SOL: -1 }];
  for (const references of invalid) {
    expect(marketValue(token, pool, references, assets)).toBeNull();
  }
  expect(
    marketValue({ ...token, quoteMint: "other" }, pool, { SOL: 100 }, assets),
  ).toBeNull();
  expect(
    marketValue(token, { ...pool, graduated: true }, { SOL: 100 }, assets),
  ).toBeNull();
  expect(
    marketValue(
      token,
      { ...pool, graduated: true, marketVenue: "damm-v2" },
      { SOL: 100 },
      assets,
    ),
  ).toBe(10000);
});
