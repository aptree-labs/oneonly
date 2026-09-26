import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { FEE_ESCROW_PROGRAM, discriminator } from "@oneonly/fee-escrow";
const mock = vi.hoisted(() => ({
  network: "devnet",
  account: vi.fn(),
  assertNetwork: vi.fn(),
}));
vi.mock("@oneonly/protocol", async () => ({
  ...(await import("@solana/web3.js")),
  get NETWORK() {
    return mock.network;
  },
  connection: () => ({ getAccountInfo: mock.account }),
  assertNetwork: mock.assertNetwork,
}));
vi.mock("../launchpad/auth", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
}));
import { creatorFeeRuntime } from "./runtime";
const signer = Keypair.generate();
const verifier = signer.publicKey;
beforeEach(() => {
  vi.clearAllMocks();
  mock.network = "devnet";
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  vi.stubEnv("CREATOR_FEES_ENABLED", "true");
  vi.stubEnv("CREATOR_FEE_PROGRAM_ID", FEE_ESCROW_PROGRAM.toBase58());
  vi.stubEnv("CREATOR_FEE_VERIFIER_PUBLIC_KEY", verifier.toBase58());
  vi.stubEnv(
    "CREATOR_FEE_VERIFIER_SECRET_KEY",
    JSON.stringify(Array.from(signer.secretKey)),
  );
  mock.assertNetwork.mockResolvedValue(undefined);
  mock.account.mockImplementation(async (key) =>
    key.equals(FEE_ESCROW_PROGRAM)
      ? { executable: true }
      : {
          owner: FEE_ESCROW_PROGRAM,
          data: Buffer.concat([
            discriminator("account", "Config"),
            verifier.toBuffer(),
            Buffer.from([1]),
          ]),
        },
  );
});
afterEach(() => vi.unstubAllEnvs());
it.each(["production", "mainnet", "disabled"])(
  "blocks %s before RPC access",
  async (scenario) => {
    if (scenario === "production")
      vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
    if (scenario === "mainnet") mock.network = "mainnet-beta";
    if (scenario === "disabled") vi.stubEnv("CREATOR_FEES_ENABLED", "false");
    await expect(creatorFeeRuntime()).rejects.toThrow("not enabled");
    expect(mock.account).not.toHaveBeenCalled();
    expect(mock.assertNetwork).not.toHaveBeenCalled();
  },
);
it("requires the RPC genesis guard before executable-account checks", async () => {
  mock.assertNetwork.mockRejectedValueOnce(new Error("Wrong chain genesis"));
  await expect(creatorFeeRuntime()).rejects.toThrow("Wrong chain genesis");
  expect(mock.account).not.toHaveBeenCalled();
});
it("rejects an arbitrary executable program identifier", async () => {
  vi.stubEnv("CREATOR_FEE_PROGRAM_ID", Keypair.generate().publicKey.toBase58());
  await expect(creatorFeeRuntime()).rejects.toThrow("Unsupported");
  expect(mock.account).not.toHaveBeenCalled();
});
it("requires a deployed executable escrow and its actual configured verifier", async () => {
  mock.account.mockResolvedValueOnce({ executable: false });
  await expect(creatorFeeRuntime()).rejects.toThrow("not available");
  mock.account
    .mockResolvedValueOnce({ executable: true })
    .mockResolvedValueOnce({
      owner: FEE_ESCROW_PROGRAM,
      data: Buffer.concat([
        discriminator("account", "Config"),
        Keypair.generate().publicKey.toBuffer(),
        Buffer.from([1]),
      ]),
    });
  await expect(creatorFeeRuntime()).rejects.toThrow("does not match");
});
it("enables only the deployed devnet program with matching on-chain verifier", async () => {
  expect(await creatorFeeRuntime()).toEqual({
    program: FEE_ESCROW_PROGRAM,
    verifier,
  });
  expect(mock.assertNetwork).toHaveBeenCalledOnce();
  expect(mock.account).toHaveBeenCalledTimes(2);
});

it.each([
  undefined,
  "malformed",
  "[]",
  JSON.stringify(Array(64).fill(256)),
  JSON.stringify(Array.from(Keypair.generate().secretKey)),
])(
  "rejects missing, invalid or mismatched signer before RPC (%#)",
  async (value) => {
    vi.stubEnv("CREATOR_FEE_VERIFIER_SECRET_KEY", value);
    await expect(creatorFeeRuntime()).rejects.toThrow(
      "signing is not configured",
    );
    expect(mock.account).not.toHaveBeenCalled();
    expect(mock.assertNetwork).not.toHaveBeenCalled();
  },
);
