import { afterEach, expect, it, vi } from "vitest";
import { defaultCurve } from "@oneonly/protocol";
const mock = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue("unsigned-config"),
  prepare: vi.fn(),
  prices: vi.fn(),
  existing: null as any,
  type: 0,
  previous: [] as any[],
  reconcile: vi.fn(),
  retire: vi.fn(),
}));
vi.mock("@oneonly/protocol", async (original) => ({
  ...(await original<typeof import("@oneonly/protocol")>()),
  NETWORK: "mainnet-beta",
  assertNetwork: async () => {},
  connection: () => ({ getBlockHeight: async () => 100 }),
  quoteAsset: () => ({
    config: "legacy-config",
    launchTokenType: mock.type,
    decimals: 6,
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  }),
  configuredPool: async () => ({ config: mock.existing }),
  quoteMintInfo: async () => ({
    decimals: 6,
    mintAuthority: null,
    freezeAuthority: null,
  }),
  client: () => ({ partner: { createConfig: mock.create } }),
}));
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<typeof import("@oneonly/db")>()),
  getDatabase: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => mock.previous }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: mock.retire }) }),
    }),
  }),
}));
vi.mock("./auth", async (original) => ({
  ...(await original<typeof import("./auth")>()),
  rateLimit: async () => {},
}));
vi.mock("./transactions", () => ({
  prepareIntent: mock.prepare,
  reconcile: mock.reconcile,
}));
vi.mock("./price", () => ({ prices: mock.prices }));
import { preparePoolConfig } from "./setup";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mock.type = 0;
  mock.previous = [];
});
it("replaces a legacy configuration with Token-2022 without repricing its fixed target", async () => {
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  const owner = "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR";
  vi.stubEnv("ONEONLY_FEE_WALLET", owner);
  mock.existing = defaultCurve("JUP", 54321, "mainnet-beta", 0);
  await preparePoolConfig(owner, "JUP");
  expect(mock.prices).not.toHaveBeenCalled();
  const config = mock.create.mock.calls[0][0];
  expect(config.tokenType).toBe(1);
  expect(config.migrationQuoteThreshold.toString()).toBe("54321000000");
  expect(mock.prepare.mock.calls[0][1]).toBe("setup-token2022-JUP");
  expect(mock.prepare.mock.calls[0][4]).toMatchObject({
    replacesConfig: "legacy-config",
    deploymentVariable: "DBC_CONFIG_TOKEN2022_JUP",
  });
});
it("does not charge for another config once a Token-2022 replacement is installed", async () => {
  vi.stubEnv(
    "ONEONLY_FEE_WALLET",
    "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR",
  );
  mock.type = 1;
  await expect(
    preparePoolConfig(process.env.ONEONLY_FEE_WALLET!, "JUP"),
  ).rejects.toThrow("already configured");
  expect(mock.create).not.toHaveBeenCalled();
});
it("refuses an upgrade that would change the existing curve", async () => {
  vi.stubEnv(
    "ONEONLY_FEE_WALLET",
    "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR",
  );
  mock.existing = defaultCurve("JUP", 54321, "mainnet-beta", 0);
  mock.existing.sqrtStartPrice = mock.existing.sqrtStartPrice.addn(1);
  await expect(
    preparePoolConfig(process.env.ONEONLY_FEE_WALLET!, "JUP"),
  ).rejects.toThrow("preserve the exact curve");
  expect(mock.create).not.toHaveBeenCalled();
});
it("rebuilds a nearly expired unsigned setup before wallet approval", async () => {
  vi.stubEnv(
    "ONEONLY_FEE_WALLET",
    "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR",
  );
  mock.existing = defaultCurve("JUP", 54321, "mainnet-beta", 0);
  mock.previous = [
    { id: "old", signature: null, lastValidBlockHeight: 150, details: {} },
  ];
  mock.reconcile.mockResolvedValue({ id: "old", status: "prepared" });
  mock.retire.mockResolvedValue([{ id: "old" }]);
  await preparePoolConfig(process.env.ONEONLY_FEE_WALLET!, "JUP");
  expect(mock.retire).toHaveBeenCalledOnce();
  expect(mock.create).toHaveBeenCalledOnce();
});
it("does not replace a submitted setup while its confirmation is uncertain", async () => {
  vi.stubEnv(
    "ONEONLY_FEE_WALLET",
    "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR",
  );
  mock.previous = [
    { id: "old", signature: "signed", lastValidBlockHeight: 150, details: {} },
  ];
  mock.reconcile.mockResolvedValue({ id: "old", status: "submitted" });
  expect(
    (await preparePoolConfig(process.env.ONEONLY_FEE_WALLET!, "JUP")).status,
  ).toBe("submitted");
  expect(mock.retire).not.toHaveBeenCalled();
  expect(mock.create).not.toHaveBeenCalled();
});
