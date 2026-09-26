import { beforeEach, expect, it, vi } from "vitest";
import {
  Keypair,
  Transaction,
  TransactionInstruction,
  PublicKey,
} from "@solana/web3.js";
import {
  allocationAddress,
  FEE_ESCROW_PROGRAM,
  xIdHash,
} from "@oneonly/fee-escrow";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  record: vi.fn(),
  append: vi.fn(),
}));
vi.mock("@oneonly/fee-escrow", async (original) => ({
  ...(await original<typeof import("@oneonly/fee-escrow")>()),
  readAllocation: mocks.read,
}));
vi.mock("@oneonly/protocol", async () => ({
  ...(await import("@solana/web3.js")),
  ...(await import("../../../../../packages/protocol/src/wire")),
  connection: () => ({}),
  appendFeeAllocation: mocks.append,
}));
vi.mock("./runtime", async () => ({
  creatorFeeRuntime: async () => ({
    program: (await import("@oneonly/fee-escrow")).FEE_ESCROW_PROGRAM,
  }),
}));
vi.mock("./service", () => ({
  recordFeeAllocation: mocks.record,
  FeeError: class extends Error {},
}));
import { prepareLaunchAllocation, reconcileLaunchAllocation } from "./launch";
const pool = Keypair.generate().publicKey,
  mint = Keypair.generate().publicKey,
  wallet = Keypair.generate().publicKey,
  quoteMint = Keypair.generate().publicKey,
  config = Keypair.generate().publicKey,
  escrow = allocationAddress(pool),
  recipients = [
    { xId: "123", shareBps: 6000 },
    { xId: "456", shareBps: 4000 },
  ],
  token = {
    id: "test-token",
    pool: pool.toBase58(),
    mint: mint.toBase58(),
    network: "devnet",
  },
  saved = JSON.stringify({
    program: FEE_ESCROW_PROGRAM.toBase58(),
    escrow: escrow.toBase58(),
    recipients,
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  mocks.read.mockResolvedValue({
    pool,
    baseMint: mint,
    launcher: wallet,
    shares: recipients.map((s) => ({ ...s, xIdHash: xIdHash(s.xId) })),
  });
  mocks.append.mockResolvedValue(escrow);
});
it("preserves ordinary launches without a fee allocation", async () => {
  expect(
    await reconcileLaunchAllocation(
      token,
      wallet.toBase58(),
      undefined,
      wallet.toBase58(),
    ),
  ).toBe(wallet.toBase58());
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});
it("does not record an allocation while Meteora still reports the launcher's authority", async () => {
  await expect(
    reconcileLaunchAllocation(
      token,
      wallet.toBase58(),
      saved,
      wallet.toBase58(),
    ),
  ).rejects.toThrow("Invalid saved fee allocation");
  expect(mocks.record).not.toHaveBeenCalled();
});
it("rejects a changed share or launch identity before database recording", async () => {
  mocks.read.mockResolvedValueOnce({
    pool,
    baseMint: mint,
    launcher: wallet,
    shares: [{ xIdHash: xIdHash("123"), shareBps: 10000 }],
  });
  await expect(
    reconcileLaunchAllocation(
      token,
      wallet.toBase58(),
      saved,
      escrow.toBase58(),
    ),
  ).rejects.toThrow("does not match");
  expect(mocks.record).not.toHaveBeenCalled();
});
it("records only the confirmed immutable allocation", async () => {
  expect(
    await reconcileLaunchAllocation(
      token,
      wallet.toBase58(),
      saved,
      escrow.toBase58(),
    ),
  ).toBe(escrow.toBase58());
  expect(mocks.record).toHaveBeenCalledWith(
    expect.objectContaining({
      recipients,
      pool: token.pool,
      network: "devnet",
    }),
  );
});
it("refuses shared launch reconciliation outside staging", async () => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  await expect(
    reconcileLaunchAllocation(
      token,
      wallet.toBase58(),
      saved,
      escrow.toBase58(),
    ),
  ).rejects.toThrow("Unsupported");
  expect(mocks.record).not.toHaveBeenCalled();
});
it("rejects a too-large packet with actionable first-buy advice", async () => {
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [],
      data: Buffer.alloc(1200),
    }),
  );
  await expect(
    prepareLaunchAllocation(tx, {
      wallet: wallet.toBase58(),
      pool: token.pool,
      config: config.toBase58(),
      mint: token.mint,
      quoteMint: quoteMint.toBase58(),
      recipients,
    }),
  ).rejects.toThrow("Skip the first buy");
});
it("checks a fitting packet including the priority budget before persisting metadata", async () => {
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: PublicKey.default,
      keys: [],
      data: Buffer.from([0]),
    }),
  );
  const result = JSON.parse(
    await prepareLaunchAllocation(tx, {
      wallet: wallet.toBase58(),
      pool: token.pool,
      config: config.toBase58(),
      mint: token.mint,
      quoteMint: quoteMint.toBase58(),
      recipients,
    }),
  );
  expect(result.recipients).toEqual(recipients);
  expect(tx.instructions.length).toBe(3);
});
