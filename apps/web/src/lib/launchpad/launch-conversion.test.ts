import { expect, it, vi } from "vitest";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
const state = vi.hoisted(() => ({ simulate: vi.fn(), route: vi.fn() }));
vi.mock("./auth", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("@oneonly/protocol", () => ({
  NETWORK: "mainnet-beta",
  configuredPool: async () => ({}),
  quoteAsset: () => ({ mint: "11111111111111111111111111111111", decimals: 8 }),
  QUOTE_MINTS: { SOL: "So11111111111111111111111111111111111111112" },
  quoteProgram: async () => PublicKey.default,
  jupiterRoute: state.route,
  routeLookupTables: async () => [],
  connection: () => ({
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
    }),
    simulateTransaction: state.simulate,
  }),
}));
import { launchConversion } from "./launch-conversion";
it("commits only the conservative conversion output and splits slippage between two approvals", async () => {
  state.route.mockResolvedValue({
    minimumOut: 1_000_000n,
    out: 1_005_000n,
    lookupAddresses: [],
    setup: [],
    cleanup: [],
    swap: new TransactionInstruction({
      programId: PublicKey.default,
      keys: [],
      data: Buffer.alloc(0),
    }),
  });
  state.simulate.mockResolvedValue({ value: { err: null } });
  const result = await launchConversion(
    PublicKey.default.toBase58(),
    { quote: "SPYX", initialBuy: "0.1", slippageBps: 100 },
    { SPYX: 750 },
    1.25,
  );
  expect(result.quoteAmount).toBe("1000000");
  expect(result.details.minimumOutput).toBe("0.0125 SPYX");
  expect(state.route.mock.calls.at(-1)?.[0].slippageBps).toBe(50);
  expect(state.simulate.mock.calls.at(-1)?.[1].sigVerify).toBe(false);
  expect(result.details.nextStep).toContain("stays in your wallet");
});
it("does not prepare a conversion with less than $5 guaranteed output, or a failed simulation", async () => {
  await expect(
    launchConversion(
      PublicKey.default.toBase58(),
      { quote: "SPYX", initialBuy: "0.1", slippageBps: 100 },
      { SPYX: 100 },
      1,
    ),
  ).rejects.toThrow("at least $5");
  state.simulate.mockResolvedValue({ value: { err: "InsufficientFunds" } });
  await expect(
    launchConversion(
      PublicKey.default.toBase58(),
      { quote: "SPYX", initialBuy: "0.1", slippageBps: 100 },
      { SPYX: 750 },
      1,
    ),
  ).rejects.toThrow("could not be simulated");
});
