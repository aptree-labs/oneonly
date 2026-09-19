import { it, expect } from "vitest";
import {
  VersionedMessage,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  decodeTransactionEvents,
  canonicalSwapEvents,
  defaultCurve,
} from "./index";
import fixture from "./fixtures/devnet-swap.json";
import dammBuy from "./fixtures/devnet-damm-buy.json";
import dammSell from "./fixtures/devnet-damm-sell.json";
import { quoteAssets } from "./quote-assets";
it("decodes real devnet self-CPI events and counts a swap2 trade once", () => {
  const transaction = {
    transaction: {
      message: VersionedMessage.deserialize(
        Buffer.from(fixture.message, "base64"),
      ),
    },
    meta: {
      innerInstructions: fixture.innerInstructions,
      logMessages: fixture.logMessages,
    },
  } as unknown as VersionedTransactionResponse;
  const events = decodeTransactionEvents(transaction);
  expect(events.map((event) => event.name)).toEqual(["evtSwap", "evtSwap2"]);
  const swaps = canonicalSwapEvents(events);
  expect(swaps).toHaveLength(1);
  expect(swaps[0].data.swapResult.includedFeeInputAmount.toString()).toBe(
    "10000000",
  );
  expect(swaps[0].data.swapResult.outputAmount.toString()).toBe("369828736794");
  // Repeated swaps in one transaction remain two trades.
  expect(canonicalSwapEvents([...events, ...events])).toHaveLength(2);
});
it("decodes confirmed DAMM buy and sell events with their actual amounts", () => {
  for (const [fixture, direction, input] of [
    [dammBuy, 1, "1000000"],
    [dammSell, 0, "1000000000"],
  ] as const) {
    const tx = {
      transaction: {
        message: VersionedMessage.deserialize(
          Buffer.from(fixture.message, "base64"),
        ),
      },
      meta: {
        innerInstructions: fixture.innerInstructions,
        logMessages: fixture.logMessages,
      },
    } as unknown as VersionedTransactionResponse;
    const events = decodeTransactionEvents(tx, "damm-v2").filter(
      (event) => event.name === "evtSwap2",
    );
    expect(events).toHaveLength(1);
    expect(events[0].data.tradeDirection).toBe(direction);
    expect(events[0].data.swapResult.includedFeeInputAmount.toString()).toBe(
      input,
    );
    expect(
      BigInt(events[0].data.swapResult.outputAmount.toString()),
    ).toBeGreaterThan(0n);
    expect(decodeTransactionEvents(tx)).toHaveLength(0);
  }
});
it("rejects duplicate or wrong-network quote assets and never enables a missing config", () => {
  expect(quoteAssets({})).toHaveLength(2);
  expect(quoteAssets({})[1].config).toBeNull();
  const asset = {
    network: "mainnet-beta",
    symbol: "STOCK",
    name: "Stock fixture",
    category: "Stocks",
    decimals: 8,
    mint: "11111111111111111111111111111111",
  };
  expect(() =>
    quoteAssets({ ONEONLY_QUOTE_ASSETS: JSON.stringify([asset]) }),
  ).toThrow();
  asset.network = "devnet";
  expect(
    quoteAssets({ ONEONLY_QUOTE_ASSETS: JSON.stringify([asset]) })[2].decimals,
  ).toBe(8);
  expect(() =>
    quoteAssets({ ONEONLY_QUOTE_ASSETS: JSON.stringify([asset, asset]) }),
  ).toThrow();
});
it("builds the fixed-supply curve and agreed fee split for each supported quote", () => {
  for (const symbol of ["SOL", "USDC"] as const) {
    const config = defaultCurve(symbol);
    expect(config.creatorTradingFeePercentage).toBe(50);
    expect(config.poolFees.baseFee.cliffFeeNumerator.toString()).toBe(
      "12500000",
    );
    expect(config.migrationOption).toBe(1);
    expect(
      config.creatorPermanentLockedLiquidityPercentage +
        config.partnerPermanentLockedLiquidityPercentage,
    ).toBe(100);
  }
});

it("keeps the 1.25% mainnet fee after graduation without a dynamic surcharge", () => {
  for (const symbol of ["SOL", "USDC"] as const) {
    const config = defaultCurve(symbol, undefined, "mainnet-beta");
    expect(config.tokenType).toBe(1);
    expect(config.tokenUpdateAuthority).toBe(1);
    expect(config.migrationFeeOption).toBe(6);
    expect(config.migratedPoolFee).toEqual({
      collectFeeMode: 0,
      dynamicFee: 0,
      poolFeeBps: 125,
    });
    expect(config.migratedPoolBaseFeeMode).toBe(0);
    expect(config.compoundingFeeBps).toBe(0);
    expect(defaultCurve(symbol, undefined, "devnet").migrationFeeOption).toBe(
      2,
    );
  }
});

it("switches only explicitly installed pairs to Token-2022 and retains legacy configs until then", () => {
  const assets = quoteAssets({
    SOLANA_NETWORK: "mainnet-beta",
    DBC_CONFIG_SOL: "legacy-sol",
    DBC_CONFIG_USDC: "legacy-usdc",
    DBC_CONFIG_TOKEN2022_SOL: "new-sol",
  });
  expect(assets.find((a) => a.symbol === "SOL")).toMatchObject({
    config: "new-sol",
    launchTokenType: 1,
  });
  expect(assets.find((a) => a.symbol === "USDC")).toMatchObject({
    config: "legacy-usdc",
    launchTokenType: 0,
  });
});

it("selects Circle mainnet USDC and lists only the five verified, pending stock integrations", () => {
  const assets = quoteAssets({ SOLANA_NETWORK: "mainnet-beta" });
  expect(assets.find((asset) => asset.symbol === "USDC")?.mint).toBe(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  );
  expect(
    assets
      .filter((asset) => asset.category === "Stocks")
      .map((asset) => asset.symbol),
  ).toEqual(["SPYX", "QQQX", "NVDAX", "TSLAX", "CRCLX"]);
  expect(
    assets
      .filter((asset) => asset.category === "Stocks")
      .every((asset) => asset.unavailableReason && asset.decimals === 8),
  ).toBe(true);
  expect(() =>
    quoteAssets({
      SOLANA_NETWORK: "mainnet-beta",
      ONEONLY_QUOTE_ASSETS: JSON.stringify([
        {
          network: "devnet",
          symbol: "EXTRA",
          name: "Wrong chain",
          category: "Tokens",
          decimals: 6,
          mint: "11111111111111111111111111111111",
        },
      ]),
    }),
  ).toThrow();
});
