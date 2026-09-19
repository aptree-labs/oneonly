import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  prepareIntent: vi.fn(),
  client: vi.fn(),
  previous: {
    id: "config-intent",
    lastValidBlockHeight: 1000,
    transaction: "saved-wire",
    details: { network: "mainnet-beta", configAddress: "saved-config" },
  },
}));
vi.mock("./price", () => ({ prices: vi.fn() }));
vi.mock("@oneonly/protocol", () => ({
  NETWORK: "mainnet-beta",
  assertNetwork: vi.fn(),
  client: mocks.client,
  defaultCurve: vi.fn(),
  Keypair: {},
  PublicKey: vi.fn(),
  quoteAsset: () => ({ config: null }),
  MAINNET_STOCKS: [{ symbol: "SPYX", setupThreshold: 14 }],
  MAINNET_TOKENS: [{ symbol: "JUP" }, { symbol: "MET" }],
  quoteAssets: () => [{ symbol: "SPYX", config: null }],
  inspectStockSetup: vi.fn(),
  connection: () => ({ getBlockHeight: async () => 1 }),
}));
vi.mock("@oneonly/db", () => ({
  getDatabase: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [mocks.previous] }),
        }),
      }),
    }),
  }),
  transactionIntents: {},
  and: vi.fn(),
  eq: vi.fn(),
  desc: vi.fn(),
  isNull: vi.fn(),
}));
vi.mock("./auth", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
  rateLimit: vi.fn(),
}));
vi.mock("./transactions", () => ({
  prepareIntent: mocks.prepareIntent,
  reconcile: mocks.reconcile,
}));
import { preparePoolConfig } from "./setup";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("refuses setup for a wallet other than the platform owner", async () => {
  vi.stubEnv("ONEONLY_FEE_WALLET", "owner");
  await expect(preparePoolConfig("another-wallet", "SOL")).rejects.toThrow(
    "platform owner",
  );
  expect(mocks.prepareIntent).not.toHaveBeenCalled();
});
it("resumes the existing owner intent instead of preparing another rent-paying config", async () => {
  vi.stubEnv("ONEONLY_FEE_WALLET", "owner");
  mocks.reconcile.mockResolvedValue({
    id: "config-intent",
    status: "prepared",
  });
  const result = await preparePoolConfig("owner", "USDC");
  expect(mocks.reconcile).toHaveBeenCalledWith("config-intent", "owner");
  expect(result.transaction).toBe("saved-wire");
  expect(mocks.client).not.toHaveBeenCalled();
});

it("resumes stock configuration intents without enabling trading or paying rent twice", async () => {
  vi.stubEnv("ONEONLY_FEE_WALLET", "owner");
  mocks.reconcile.mockResolvedValue({
    id: "config-intent",
    status: "confirmed",
  });
  const result = await preparePoolConfig("owner", "SPYX");
  expect(result.status).toBe("confirmed");
  expect(result.transaction).toBeUndefined();
  expect(mocks.client).not.toHaveBeenCalled();
});

it.each(["JUP", "MET"])(
  "resumes %s setup without creating a second configuration",
  async (symbol) => {
    vi.stubEnv("ONEONLY_FEE_WALLET", "owner");
    mocks.reconcile.mockResolvedValue({
      id: "config-intent",
      status: "confirmed",
    });
    const result = await preparePoolConfig("owner", symbol);
    expect(result.status).toBe("confirmed");
    expect(mocks.client).not.toHaveBeenCalled();
  },
);
