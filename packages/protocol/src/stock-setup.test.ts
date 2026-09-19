import { afterEach, expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getExtensionData,
  ExtensionType,
  unpackMint,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { inspectStockSetup } from "./stock-setup";
import { defaultCurve, MAINNET_STOCKS, quoteAsset } from "./index";
import fixture from "./fixtures/mainnet-spyx-setup.json";

function context() {
  const accounts = fixture.accounts.map((account) => ({
    ...account,
    owner: new PublicKey(account.owner),
    data: Buffer.from(account.data, "base64"),
    rentEpoch: 0,
  }));
  const rpc = {
    getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) => {
      expect(keys.map((key) => key.toBase58())).toEqual(
        fixture.accounts.map((account) => account.address),
      );
      return accounts;
    }),
  } as unknown as Connection;
  return { accounts, rpc };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("uses the effective on-chain display multiplier and verifies both Meteora badges", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-13T00:00:00Z"));
  const { rpc } = context();
  const result = await inspectStockSetup(rpc, "SPYX");
  expect(result.multiplier).toBeCloseTo(1.005714560286254, 12);
});

it("rejects a badge with the wrong owner, mint, discriminator, or no account", async () => {
  for (const target of [1, 2])
    for (const change of ["owner", "mint", "discriminator", "missing"]) {
      const { rpc, accounts } = context();
      if (change === "owner") accounts[target].owner = PublicKey.default;
      if (change === "mint") accounts[target].data.fill(0, 8, 40);
      if (change === "discriminator") accounts[target].data[0] ^= 255;
      if (change === "missing") (accounts as unknown[])[target] = null;
      await expect(inspectStockSetup(rpc, "SPYX")).rejects.toThrow("approval");
    }
});

it("refuses newly paused, frozen, or hooked stock mints", async () => {
  for (const extension of [
    ExtensionType.PausableConfig,
    ExtensionType.DefaultAccountState,
    ExtensionType.TransferHook,
  ]) {
    const { rpc, accounts } = context();
    const info = unpackMint(
      new PublicKey(fixture.accounts[0].address),
      accounts[0],
      TOKEN_2022_PROGRAM_ID,
    );
    const data = getExtensionData(extension, info.tlvData)!;
    if (extension === ExtensionType.PausableConfig) data[32] = 1;
    else if (extension === ExtensionType.DefaultAccountState) data[0] = 2;
    else data[32] = 1;
    await expect(inspectStockSetup(rpc, "SPYX")).rejects.toThrow(
      /paused|frozen|hook/,
    );
  }
});

it("builds all five stock thresholds in eight-decimal units while keeping trading closed", () => {
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  for (const stock of MAINNET_STOCKS) {
    const curve = defaultCurve(stock.symbol, undefined, "mainnet-beta");
    expect(curve.migrationQuoteThreshold.toString()).toBe(
      String(BigInt(stock.setupThreshold) * 100_000_000n),
    );
    expect(curve.migratedPoolFee.poolFeeBps).toBe(125);
    expect(() => quoteAsset(stock.symbol)).toThrow("release verification");
  }
});
