import { expect, it } from "vitest";
import { MAINNET_TOKENS, tokenSetupThreshold } from "./mainnet-tokens";
import { quoteAssets } from "./quote-assets";
import { defaultCurve } from "./index";

it("enables only the official token mints on mainnet, without inventing launch configs", () => {
  expect(
    quoteAssets({}).some((asset) => ["JUP", "MET"].includes(asset.symbol)),
  ).toBe(false);
  const assets = quoteAssets({ SOLANA_NETWORK: "mainnet-beta" });
  for (const token of MAINNET_TOKENS) {
    expect(assets.find((asset) => asset.symbol === token.symbol)).toMatchObject(
      {
        mint: token.mint,
        decimals: 6,
        referenceMint: token.mint,
        category: "Tokens",
        config: null,
      },
    );
    expect(() => defaultCurve(token.symbol, 50_000, "devnet")).toThrow(
      "Unsupported",
    );
    expect(() => defaultCurve(token.symbol, undefined, "mainnet-beta")).toThrow(
      "positive",
    );
  }
});

it.each(["JUP", "MET"])(
  "builds %s in six-decimal units with the existing supply, fees and LP locks",
  (symbol) => {
    const threshold = tokenSetupThreshold(symbol, 0.3);
    expect(threshold).toBe(33334);
    const curve = defaultCurve(symbol, threshold, "mainnet-beta");
    expect(curve.migrationQuoteThreshold.toString()).toBe("33334000000");
    expect(curve.migratedPoolFee.poolFeeBps).toBe(125);
    expect(curve.creatorTradingFeePercentage).toBe(50);
    expect(curve.creatorPermanentLockedLiquidityPercentage).toBe(50);
    expect(curve.partnerPermanentLockedLiquidityPercentage).toBe(50);
    expect(curve.tokenSupply?.preMigrationTokenSupply.toString()).toBe(
      "1000000000000000",
    );
  },
);

it("rejects missing or invalid references and duplicate allowlist assets", () => {
  for (const price of [NaN, Infinity, 0, -1, 1e-12])
    expect(() => tokenSetupThreshold("JUP", price)).toThrow();
  const token = MAINNET_TOKENS[0];
  expect(() =>
    quoteAssets({
      SOLANA_NETWORK: "mainnet-beta",
      ONEONLY_QUOTE_ASSETS: JSON.stringify([
        { ...token, network: "mainnet-beta", category: "Tokens" },
      ]),
    }),
  ).toThrow();
});
