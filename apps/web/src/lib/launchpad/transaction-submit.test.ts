import { beforeEach, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  intent: {} as any,
  send: vi.fn(),
  updates: 0,
  token: {} as any,
  buildClaim: vi.fn(),
  chainStatus: null as any,
}));
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<typeof import("@oneonly/db")>()),
  getDatabase: async () => ({
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve([{ ...mock.intent }]), {
            limit: async () => [mock.token],
          }),
      }),
    }),
    update: () => ({
      set: (value: any) => ({
        where: () => ({
          returning: async () => {
            if (mock.intent.status !== "prepared") return [];
            Object.assign(mock.intent, value);
            mock.updates++;
            return [{ ...mock.intent }];
          },
        }),
      }),
    }),
  }),
}));
vi.mock("@oneonly/protocol", async (original) => ({
  ...(await original<typeof import("@oneonly/protocol")>()),
  assertNetwork: async () => {},
  buildClaim: mock.buildClaim,
  buildDammClaim: mock.buildClaim,
  connection: () => ({
    getBlockHeight: async () => 1,
    getSignatureStatuses: async () => ({ value: [mock.chainStatus] }),
    sendRawTransaction: mock.send,
  }),
}));
vi.mock("./auth", async (original) => ({
  ...(await original<typeof import("./auth")>()),
  rateLimit: async () => {},
}));
import {
  Keypair,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { prepareTransactionWire } from "@oneonly/protocol";
import { submit, reviewChangedFee, reconcile } from "./transactions";
let payer: Keypair, tx: Transaction;
beforeEach(() => {
  mock.send.mockReset().mockResolvedValue("signature");
  mock.updates = 0;
  mock.chainStatus = null;
  payer = Keypair.generate();
  tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 7,
    }),
  );
  const prepared = prepareTransactionWire(
    tx,
    payer.publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
  );
  mock.intent = {
    id: "intent",
    kind: "trade",
    status: "prepared",
    message: prepared.message,
    transaction: prepared.wire,
    blockhash: tx.recentBlockhash,
    lastValidBlockHeight: 100,
    tokenId: "11111111-1111-4111-8111-111111111111",
    details: {},
  };
  mock.token = { creator: payer.publicKey.toBase58(), pool: "fixture-pool" };
  mock.buildClaim
    .mockReset()
    .mockImplementation(async () =>
      Transaction.from(Buffer.from(prepared.wire, "base64")),
    );
});

function addWalletGuard() {
  const data = Buffer.from(
    "06040300def3ff7d000000000403000001000000000000000000",
    "hex",
  );
  tx.add(
    new TransactionInstruction({
      programId: new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"),
      keys: [{ pubkey: payer.publicKey, isSigner: false, isWritable: false }],
      data,
    }),
  );
}
it("submits a cached client's first claim approval without persisting unsigned wallet guards", async () => {
  mock.intent.kind = "claim";
  addWalletGuard();
  tx.sign(payer);
  const wire = tx.serialize().toString("base64");
  const result = await reviewChangedFee(
    payer.publicKey.toBase58(),
    "intent",
    wire,
  );
  expect(result.status).toBe("submitted");
  expect(result.kind).toBe("claim");
  expect(mock.intent.transaction).toBe(wire);
  expect(mock.send).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  "rebuilds a frozen claim guard baseline while rejecting changed claim data (tamper=%s)",
  async (tamper) => {
    mock.intent.kind = "claim";
    addWalletGuard();
    mock.intent.transaction = tx
      .serialize({ requireAllSignatures: false })
      .toString("base64");
    mock.intent.message = tx.serializeMessage().toString("base64");
    // Phantom recalculates its balance assertion during a second approval.
    tx.instructions.at(-1)!.data[5] ^= 1;
    if (tamper) tx.instructions[2].data[4] ^= 1;
    tx.sign(payer);
    const wire = tx.serialize().toString("base64");
    if (tamper) {
      await expect(
        submit(payer.publicKey.toBase58(), "intent", wire),
      ).rejects.toThrow("more than");
      expect(mock.send).not.toHaveBeenCalled();
    } else {
      expect(
        (await submit(payer.publicKey.toBase58(), "intent", wire)).status,
      ).toBe("submitted");
      expect(mock.intent.transaction).toBe(wire);
      expect(mock.send).toHaveBeenCalledTimes(1);
    }
    expect(mock.buildClaim).toHaveBeenCalledWith(
      "fixture-pool",
      payer.publicKey.toBase58(),
    );
  },
);
it("submits wallet-approved fee changes once even when requests overlap", async () => {
  tx.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 2000,
  });
  tx.sign(payer);
  const wire = tx.serialize().toString("base64");
  const results = await Promise.all([
    submit(payer.publicKey.toBase58(), "intent", wire),
    submit(payer.publicKey.toBase58(), "intent", wire),
  ]);
  expect(mock.send).toHaveBeenCalledTimes(1);
  expect(mock.updates).toBe(1);
  expect(mock.intent.message).toBe(tx.serializeMessage().toString("base64"));
  expect(mock.intent.transaction).toBe(wire);
  expect(results.every((result) => result.status === "submitted")).toBe(true);
});
it("rejects changed trade amounts before broadcasting", async () => {
  tx.instructions[2].data[4] ^= 1;
  tx.sign(payer);
  await expect(
    submit(
      payer.publicKey.toBase58(),
      "intent",
      tx.serialize().toString("base64"),
    ),
  ).rejects.toThrow("more than the network fee");
  expect(mock.send).not.toHaveBeenCalled();
});
it("submits and persists the exact signed Phantom guard transaction", async () => {
  const data = Buffer.alloc(12);
  data.set([5, 0, 0]);
  data.writeBigUInt64LE(7n, 3);
  data[11] = 4;
  tx.add(
    new TransactionInstruction({
      programId: new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"),
      keys: [
        {
          pubkey: tx.instructions[2].keys[1].pubkey,
          isSigner: false,
          isWritable: false,
        },
      ],
      data,
    }),
  );
  tx.sign(payer);
  const wire = tx.serialize().toString("base64");
  const result = await submit(payer.publicKey.toBase58(), "intent", wire);
  expect(result.status).toBe("submitted");
  expect(mock.send).toHaveBeenCalledTimes(1);
  expect(Buffer.from(mock.send.mock.calls[0][0]).toString("base64")).toBe(wire);
  expect(mock.intent.transaction).toBe(wire);
  expect(mock.intent.message).toBe(tx.serializeMessage().toString("base64"));
});
it("retains a deterministic signature after a broadcast timeout", async () => {
  mock.send.mockRejectedValue(new Error("timeout"));
  tx.sign(payer);
  const result = await submit(
    payer.publicKey.toBase58(),
    "intent",
    tx.serialize().toString("base64"),
  );
  expect(result.status).toBe("submitted");
  expect(mock.intent.signature).toBeTruthy();
  expect(mock.send.mock.calls[0][1]).toEqual({
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
});
it("rebroadcasts the same signed bytes if the RPC has not seen the submitted transaction", async () => {
  tx.sign(payer);
  const wire = tx.serialize().toString("base64");
  await submit(payer.publicKey.toBase58(), "intent", wire);
  mock.send.mockClear();
  const signature = mock.intent.signature;
  expect((await reconcile("intent", payer.publicKey.toBase58())).status).toBe(
    "submitted",
  );
  expect(mock.send).toHaveBeenCalledOnce();
  expect(Buffer.from(mock.send.mock.calls[0][0]).toString("base64")).toBe(wire);
  expect(mock.intent.signature).toBe(signature);
});
it("does not rebroadcast a transaction already processed by the chain", async () => {
  tx.sign(payer);
  await submit(
    payer.publicKey.toBase58(),
    "intent",
    tx.serialize().toString("base64"),
  );
  mock.send.mockClear();
  mock.chainStatus = { confirmationStatus: "processed", err: null };
  await reconcile("intent", payer.publicKey.toBase58());
  expect(mock.send).not.toHaveBeenCalled();
});

it("accepts bounded wallet budgets for a creator claim without another approval", async () => {
  mock.intent.kind = "claim";
  const data = Buffer.alloc(5);
  data[0] = 4;
  data.writeUInt32LE(32000000, 1);
  tx.add(
    new TransactionInstruction({
      programId: ComputeBudgetProgram.programId,
      keys: [],
      data,
    }),
  );
  tx.sign(payer);
  const wire = tx.serialize().toString("base64");
  expect(
    (await submit(payer.publicKey.toBase58(), "intent", wire)).status,
  ).toBe("submitted");
  expect(mock.intent.transaction).toBe(wire);
  expect(mock.send).toHaveBeenCalledTimes(1);
});
it("still rejects a changed claim instruction without broadcasting", async () => {
  mock.intent.kind = "claim";
  tx.instructions[2].data[4] ^= 1;
  tx.sign(payer);
  await expect(
    submit(
      payer.publicKey.toBase58(),
      "intent",
      tx.serialize().toString("base64"),
    ),
  ).rejects.toThrow("more than");
  expect(mock.send).not.toHaveBeenCalled();
});
