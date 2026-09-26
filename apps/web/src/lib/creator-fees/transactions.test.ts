import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  it,
  vi,
} from "vitest";
import { createPublicKey, randomUUID, verify } from "node:crypto";
import {
  Keypair,
  PublicKey,
  Transaction,
  Ed25519Program,
} from "@solana/web3.js";
import {
  createLocalDatabase,
  creatorFeePools,
  creatorFeeChallenges,
  transactionIntents,
  eq,
  type Database,
} from "@oneonly/db";
import {
  allocationAddress,
  receiptAddress,
  discriminator,
  claimMessage,
  xIdHash,
  getAssociatedTokenAddressSync,
} from "@oneonly/fee-escrow";
const mock = vi.hoisted(() => ({
  db: undefined as unknown,
  account: vi.fn(),
  height: vi.fn(),
  runtime: vi.fn(),
  verified: vi.fn(),
  balances: vi.fn(),
  prepare: vi.fn(),
  collection: vi.fn(),
}));
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<object>()),
  getDatabase: async () => mock.db,
}));
vi.mock("@oneonly/protocol", async () => ({
  ...(await import("@solana/web3.js")),
  connection: () => ({
    getAccountInfo: mock.account,
    getBlockHeight: mock.height,
  }),
  buildFeeCollection: mock.collection,
}));
vi.mock("./runtime", () => ({ creatorFeeRuntime: mock.runtime }));
vi.mock("./balances", () => ({ readCreatorFeeBalances: mock.balances }));
vi.mock("./service", async () => ({
  FeeError: (await import("./provider")).FeeError,
  verifiedFeeChallenge: mock.verified,
}));
vi.mock("../launchpad/transactions", () => ({ prepareIntent: mock.prepare }));
import {
  prepareCreatorFeeClaim,
  prepareCreatorFeeCollection,
  reconcileCreatorFeeClaim,
} from "./transactions";
let db: Database, close: () => Promise<void>;
const program = Keypair.generate().publicKey,
  signer = Keypair.generate(),
  owner = Keypair.generate().publicKey,
  mint = Keypair.generate().publicKey;
const tokenProgram = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
let c: typeof creatorFeeChallenges.$inferSelect;
beforeAll(async () => {
  const local = await createLocalDatabase();
  db = local.db;
  mock.db = db;
  close = () => local.client.close();
}, 30000);
afterAll(async () => close());
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  vi.clearAllMocks();
  const pool = Keypair.generate().publicKey,
    tokenId = randomUUID();
  await db.insert(creatorFeePools).values({
    tokenId,
    network: "devnet",
    pool: pool.toBase58(),
    mint: mint.toBase58(),
    escrow: allocationAddress(pool, program).toBase58(),
    program: program.toBase58(),
  });
  [c] = await db
    .insert(creatorFeeChallenges)
    .values({
      id: randomUUID(),
      tokenId,
      network: "devnet",
      xId: "123456",
      wallet: owner.toBase58(),
      bindingVersion: 1,
      mint: mint.toBase58(),
      amountAtomic: "100",
      cumulativeAtomic: "150",
      program: program.toBase58(),
      escrow: allocationAddress(pool, program).toBase58(),
      code: `ONEONLY-${Buffer.alloc(32, 1).toString("hex").slice(0, 32)}${randomUUID().replaceAll("-", "")}`,
      scopeHash: "tested-by-service-suite",
      status: "verified",
      tweetId: null,
      createdAt: new Date(Math.floor(Date.now() / 1000) * 1000),
      expiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 600000),
    })
    .returning();
  mock.runtime.mockResolvedValue({ program, verifier: signer.publicKey });
  mock.verified.mockResolvedValue(c);
  mock.height.mockResolvedValue(100);
  mock.account.mockImplementation(async (key: PublicKey) =>
    key.equals(mint)
      ? {
          owner: tokenProgram,
          data: Buffer.alloc(82),
          lamports: 1,
          executable: false,
          rentEpoch: 0,
        }
      : null,
  );
  mock.balances.mockResolvedValue([
    {
      mint: mint.toBase58(),
      symbol: "SOL",
      decimals: 9,
      amountAtomic: "100",
      claimedAtomic: "50",
      totalEntitlementAtomic: "150",
      pendingAtomic: "0",
      pendingVenue: "dbc",
    },
  ]);
  mock.prepare.mockResolvedValue({ id: randomUUID(), status: "prepared" });
  vi.stubEnv(
    "CREATOR_FEE_VERIFIER_SECRET_KEY",
    JSON.stringify(Array.from(signer.secretKey)),
  );
});
async function status() {
  return (
    await db
      .select()
      .from(creatorFeeChallenges)
      .where(eq(creatorFeeChallenges.id, c.id))
  )[0];
}
function receipt(
  overrides: {
    allocation?: PublicKey;
    mint?: PublicKey;
    wallet?: PublicKey;
    nonce?: Buffer;
    amount?: bigint;
    owner?: PublicKey;
    badDiscriminator?: boolean;
  } = {},
) {
  const n = Buffer.alloc(8);
  n.writeBigUInt64LE(overrides.amount ?? 100n);
  return {
    owner: overrides.owner ?? program,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
    data: Buffer.concat([
      overrides.badDiscriminator
        ? Buffer.alloc(8)
        : discriminator("account", "Receipt"),
      (overrides.allocation ?? new PublicKey(c.escrow)).toBuffer(),
      (overrides.mint ?? mint).toBuffer(),
      (overrides.wallet ?? owner).toBuffer(),
      overrides.nonce ?? Buffer.from(c.code.slice(8), "hex"),
      n,
    ]),
  };
}
it("signs the frozen cumulative cap and exact wallet/mint/nonce scope, then marks issued without consuming", async () => {
  await prepareCreatorFeeClaim(owner.toBase58(), c.id);
  const tx = mock.prepare.mock.calls[0][2] as Transaction;
  const ed = tx.instructions.find((ix) =>
    ix.programId.equals(Ed25519Program.programId),
  )!;
  const data = ed.data,
    signatureOffset = data.readUInt16LE(2),
    keyOffset = data.readUInt16LE(6),
    messageOffset = data.readUInt16LE(10),
    messageLength = data.readUInt16LE(12);
  const expected = claimMessage(
    {
      xIdHash: xIdHash(c.xId),
      cumulativeLimit: 150n,
      bindingVersion: 1n,
      nonce: Buffer.from(c.code.slice(8), "hex"),
      issuedAt: BigInt(c.createdAt.getTime() / 1000),
      expiresAt: BigInt(c.expiresAt.getTime() / 1000),
    },
    new PublicKey(c.escrow),
    mint,
    owner,
    getAssociatedTokenAddressSync(mint, owner, false, tokenProgram),
    program,
  );
  expect(data.subarray(messageOffset, messageOffset + messageLength)).toEqual(
    expected,
  );
  expect(data.subarray(keyOffset, keyOffset + 32)).toEqual(
    signer.publicKey.toBuffer(),
  );
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      signer.publicKey.toBuffer(),
    ]),
    format: "der",
    type: "spki",
  });
  expect(
    verify(
      null,
      expected,
      publicKey,
      data.subarray(signatureOffset, signatureOffset + 64),
    ),
  ).toBe(true);
  expect((await status()).status).toBe("issued");
  expect((await status()).confirmedSignature).toBeNull();
  expect(mock.prepare.mock.calls[0][4].receivedAs).toContain("Wrapped SOL");
});
it("reuses an unexpired prepared intent without signing or requesting fresh balances", async () => {
  const [intent] = await db
    .insert(transactionIntents)
    .values({
      network: "devnet",
      wallet: owner.toBase58(),
      kind: "creator-fee-claim",
      transaction: "existing-bytes",
      message: "message",
      blockhash: "blockhash",
      lastValidBlockHeight: 200,
      details: { challengeId: c.id },
    })
    .returning();
  const result = await prepareCreatorFeeClaim(owner.toBase58(), c.id);
  expect(result.id).toBe(intent.id);
  expect(mock.prepare).not.toHaveBeenCalled();
  expect(mock.balances).not.toHaveBeenCalled();
  expect((await status()).status).toBe("verified");
});
it.each(["program", "escrow"])(
  "rejects changed %s before preparing a transaction",
  async (field) => {
    mock.verified.mockResolvedValue({
      ...c,
      [field]: Keypair.generate().publicKey.toBase58(),
    });
    await expect(
      prepareCreatorFeeClaim(owner.toBase58(), c.id),
    ).rejects.toThrow("scope changed");
    expect(mock.prepare).not.toHaveBeenCalled();
  },
);
it("does not issue another approval when a receipt already exists", async () => {
  mock.account.mockResolvedValue(receipt());
  await expect(prepareCreatorFeeClaim(owner.toBase58(), c.id)).rejects.toThrow(
    "already been paid",
  );
  expect(mock.prepare).not.toHaveBeenCalled();
});
it.each([
  undefined,
  "[]",
  "malformed",
  JSON.stringify(Array.from(Keypair.generate().secretKey)),
])(
  "fails closed for missing, malformed, or wrong verifier secret (%#)",
  async (value) => {
    vi.stubEnv("CREATOR_FEE_VERIFIER_SECRET_KEY", value);
    await expect(
      prepareCreatorFeeClaim(owner.toBase58(), c.id),
    ).rejects.toThrow("signing is not configured");
    expect(mock.prepare).not.toHaveBeenCalled();
    expect((await status()).status).toBe("verified");
  },
);
it("does not consume a challenge if the wallet rejects transaction preparation", async () => {
  mock.prepare.mockRejectedValueOnce(new Error("Wallet rejected"));
  await expect(prepareCreatorFeeClaim(owner.toBase58(), c.id)).rejects.toThrow(
    "Wallet rejected",
  );
  expect((await status()).status).toBe("verified");
});
it("requires a chain receipt before consuming, then records only the matching request", async () => {
  expect(await reconcileCreatorFeeClaim(owner.toBase58(), c.id)).toEqual({
    confirmed: false,
  });
  expect((await status()).status).toBe("verified");
  mock.account.mockResolvedValue(receipt());
  expect(
    await reconcileCreatorFeeClaim(
      owner.toBase58(),
      c.id,
      "confirmed-chain-signature",
    ),
  ).toEqual({ confirmed: true, amountAtomic: "100" });
  expect((await status()).status).toBe("consumed");
  expect((await status()).confirmedSignature).toBe("confirmed-chain-signature");
  expect(mock.account).toHaveBeenLastCalledWith(
    receiptAddress(Buffer.from(c.code.slice(8), "hex"), program),
    "confirmed",
  );
});
it.each([
  "allocation",
  "mint",
  "wallet",
  "nonce",
  "amountZero",
  "amountExceeds",
  "owner",
  "discriminator",
])("rejects mismatched receipt %s without consuming", async (field) => {
  const overrides =
    field === "nonce"
      ? { nonce: Buffer.alloc(32, 9) }
      : field === "amountZero"
        ? { amount: 0n }
        : field === "amountExceeds"
          ? { amount: 101n }
          : field === "discriminator"
            ? { badDiscriminator: true }
            : { [field]: Keypair.generate().publicKey };
  mock.account.mockResolvedValue(receipt(overrides));
  await expect(
    reconcileCreatorFeeClaim(owner.toBase58(), c.id),
  ).rejects.toThrow();
  expect((await status()).status).toBe("verified");
});
it("does not expose another wallet's claim through reconciliation", async () => {
  await expect(
    reconcileCreatorFeeClaim(Keypair.generate().publicKey.toBase58(), c.id),
  ).rejects.toThrow("not found");
  expect(mock.account).not.toHaveBeenCalled();
});
it("runtime gate blocks all adapters before any chain or transaction activity", async () => {
  mock.runtime.mockRejectedValue(new Error("Not staging devnet"));
  await expect(prepareCreatorFeeClaim(owner.toBase58(), c.id)).rejects.toThrow(
    "Not staging devnet",
  );
  await expect(
    prepareCreatorFeeCollection(owner.toBase58(), c.tokenId),
  ).rejects.toThrow("Not staging devnet");
  await expect(
    reconcileCreatorFeeClaim(owner.toBase58(), c.id),
  ).rejects.toThrow("Not staging devnet");
  expect(mock.account).not.toHaveBeenCalled();
  expect(mock.prepare).not.toHaveBeenCalled();
});
