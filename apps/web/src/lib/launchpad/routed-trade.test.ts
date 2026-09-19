import { beforeEach, expect, it, vi } from "vitest";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
const state = vi.hoisted(() => ({
  route: vi.fn(),
  quote: vi.fn(),
  build: vi.fn(),
  simulate: vi.fn(),
  strip: vi.fn((ix: unknown[]) => ix),
}));
vi.mock("./auth", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
  string: (value: unknown) => String(value),
}));
vi.mock("@oneonly/protocol", () => ({
  NETWORK: "mainnet-beta",
  assertNetwork: async () => {},
  QUOTE_MINTS: { SOL: "So11111111111111111111111111111111111111112" },
  quoteAsset: (symbol: string) => ({
    symbol,
    mint:
      symbol === "SOL"
        ? "So11111111111111111111111111111111111111112"
        : symbol === "USDC"
          ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
          : "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: symbol === "SOL" ? 9 : symbol === "USDC" ? 6 : 8,
  }),
  quoteMintInfo: async () => ({}),
  quoteMultiplier: async (symbol: string) => (symbol === "SPYX" ? 1.25 : 1),
  quoteProgram: async () => PublicKey.default,
  quoteSwap: state.quote,
  buildSwap: state.build,
  jupiterRoute: state.route,
  routeLookupTables: async () => [],
  intermediateSolInstructions: state.strip,
  connection: () => ({
    getLatestBlockhash: async () => ({
      blockhash: PublicKey.default.toBase58(),
    }),
    simulateTransaction: state.simulate,
  }),
}));
import { routedTrade } from "./routed-trade";
beforeEach(() => {
  vi.clearAllMocks();
  const ix = (value: number) =>
    new TransactionInstruction({
      programId: PublicKey.default,
      keys: [],
      data: Buffer.from([value]),
    });
  state.route.mockResolvedValue({
    out: 1100000n,
    minimumOut: 1000000n,
    lookupAddresses: [],
    setup: [ix(1)],
    swap: ix(2),
    cleanup: [ix(4)],
  });
  state.quote.mockResolvedValue({
    out: "2000000",
    minimumOut: "1900000",
    venue: "dbc",
    consumedInput: "1000000",
  });
  state.build.mockResolvedValue(new Transaction().add(ix(3)));
  state.simulate.mockResolvedValue({ value: { err: null } });
});
it("buys a SOL-paired token using USDC and consumes only the guaranteed intermediate output", async () => {
  const result = await routedTrade(
    PublicKey.default.toBase58(),
    { pool: "pool", quote: "SOL", ticker: "TEST" },
    { side: "buy", settlement: "USDC", amount: "2.5", slippageBps: 100 },
  );
  expect(state.route.mock.calls[0][0]).toMatchObject({
    amount: 2500000n,
    slippageBps: 50,
  });
  expect(state.quote.mock.calls[0]).toEqual(["pool", 1000000n, false, 50]);
  expect(state.strip).toHaveBeenCalledTimes(1);
  expect(result.details.input).toBe("2.5 USDC");
  expect(result.details.minimumOutput).toBe("1.9 TEST");
  expect(
    result.transaction.message.compiledInstructions
      .slice(2)
      .map((ix) => ix.data[0]),
  ).toEqual([1, 2, 3, 4]);
});
it("sells through the pool before conversion, preserving scaled stock output units", async () => {
  const result = await routedTrade(
    PublicKey.default.toBase58(),
    { pool: "pool", quote: "SOL", ticker: "TEST" },
    { side: "sell", settlement: "SPYX", amount: "1", slippageBps: 100 },
  );
  expect(state.route.mock.calls[0][0].amount).toBe(1900000n);
  expect(result.details.minimumOutput).toBe("0.0125 SPYX");
  expect(
    result.transaction.message.compiledInstructions
      .slice(2)
      .map((ix) => ix.data[0]),
  ).toEqual([1, 3, 2, 4]);
  expect(state.strip).toHaveBeenCalledTimes(2);
});
it("converts scaled stock input to raw units and rejects failed simulations", async () => {
  await routedTrade(
    PublicKey.default.toBase58(),
    { pool: "pool", quote: "USDC", ticker: "TEST" },
    { side: "buy", settlement: "SPYX", amount: "0.0125", slippageBps: 100 },
  );
  expect(state.route.mock.calls[0][0].amount).toBe(1000000n);
  state.simulate.mockResolvedValue({ value: { err: "InsufficientFunds" } });
  await expect(
    routedTrade(
      PublicKey.default.toBase58(),
      { pool: "pool", quote: "USDC", ticker: "TEST" },
      { side: "buy", settlement: "SOL", amount: "1", slippageBps: 100 },
    ),
  ).rejects.toThrow("could not be simulated");
});
