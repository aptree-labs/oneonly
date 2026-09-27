import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  createDeploymentManifest,
  DEPLOYMENT_GENESIS,
  UPGRADEABLE_LOADER,
} from "../src/deployment";
import {
  startDeploymentConsole,
  type ConsoleRpc,
} from "../scripts/deployment-console";
let directory: string,
  local: Awaited<ReturnType<typeof startDeploymentConsole>>,
  wallet: Keypair,
  rpc: ConsoleRpc,
  capability: string;
let startInput: Parameters<typeof startDeploymentConsole>[0];
let signature: string, bytes: Buffer, finalized: boolean, feeReceipt: boolean;
const journal = () =>
  JSON.parse(readFileSync(join(directory, "journal.json"), "utf8"));
async function post(
  path: string,
  data: unknown = {},
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${local.origin}/api/${path}`, {
    method: "POST",
    headers: {
      Origin: local.origin,
      "Content-Type": "application/json",
      "X-Deployment-Capability": capability,
      ...headers,
    },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "oneonly-deploy-test-"));
  wallet = Keypair.generate();
  const program = Keypair.generate(),
    buffer = Keypair.generate();
  const artifact = Buffer.alloc(100, 7);
  Buffer.from([127, 69, 76, 70]).copy(artifact);
  finalized = false;
  feeReceipt = true;
  rpc = {
    getGenesisHash: vi.fn().mockResolvedValue(DEPLOYMENT_GENESIS.devnet),
    getMultipleAccountsInfo: vi.fn(async (keys: unknown[]) =>
      keys.map(() => null),
    ),
    getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(1000),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 200,
    }),
    getFeeForMessage: vi.fn().mockResolvedValue({ value: 5000 }),
    getBlockHeight: vi.fn().mockResolvedValue(100),
    getSignatureStatuses: vi.fn(async () => ({
      value: [
        finalized ? { confirmationStatus: "finalized", err: null } : null,
      ],
    })),
    getTransaction: vi.fn(async () =>
      feeReceipt
        ? {
            meta: { fee: 5000, preBalances: [100000], postBalances: [94000] },
            transaction: {
              message: {
                getAccountKeys: () => ({ get: () => wallet.publicKey }),
              },
            },
          }
        : null,
    ),
    sendRawTransaction: vi.fn(async (raw: Uint8Array) => {
      bytes = Buffer.from(raw);
      const saved = journal().entries.at(-1);
      expect(saved.signedTransaction).toBe(bytes.toString("base64"));
      expect(statSync(join(directory, "journal.json")).mode & 0o077).toBe(0);
      signature = saved.signature;
      throw new Error("RPC timed out");
    }),
  } as unknown as ConsoleRpc;
  const manifest = createDeploymentManifest({
    network: "devnet",
    artifact,
    wallet: wallet.publicKey,
    program: program.publicKey,
    buffer: buffer.publicKey,
    maxTotalLamports: 100000n,
    maxFeePerTransactionLamports: 10000n,
  });
  startInput = {
    rpc,
    manifest,
    artifact,
    localKeys: { program, buffer },
    stateDirectory: directory,
  };
  local = await startDeploymentConsole(startInput);
  capability = new URL(
    JSON.parse(readFileSync(local.accessPath, "utf8")).url,
  ).hash.slice(1);
});
afterEach(async () => {
  await local?.close();
  rmSync(directory, { recursive: true, force: true });
});
async function signed() {
  const result = await post("prepare");
  expect(result.status).toBe(200);
  const transaction = Transaction.from(
    Buffer.from(result.body.transaction, "base64"),
  );
  transaction.partialSign(wallet);
  return {
    id: result.body.id,
    transaction: transaction.serialize().toString("base64"),
  };
}
it("guards local origin, host and ASCII capability without crashing", async () => {
  expect(
    (await post("status", {}, { Origin: "https://evil.example" })).status,
  ).toBe(403);
  expect(
    (await post("status", {}, { "X-Deployment-Capability": "é".repeat(64) }))
      .status,
  ).toBe(403);
  expect(
    await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        local.origin,
        { method: "GET", headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    }),
  ).toBe(403);
  expect((await post("status")).status).toBe(200);
  expect(statSync(local.accessPath).mode & 0o077).toBe(0);
});
it("persists exact signed bytes before broadcast, blocks replacement and rebroadcasts identical bytes", async () => {
  expect((await post("submit", await signed())).status).toBe(202);
  const original = Buffer.from(bytes);
  expect((await post("prepare")).status).toBe(400);
  vi.mocked(rpc.sendRawTransaction).mockImplementation(async (raw) => {
    expect(Buffer.from(raw)).toEqual(original);
    return signature;
  });
  expect((await post("rebroadcast")).status).toBe(200);
  expect(journal().entries).toHaveLength(1);
  expect((await post("status")).body.reservedLamports).toBe("6000");
  finalized = true;
  expect((await post("status")).body).toMatchObject({
    actualFeesLamports: "5000",
    netAccountFundingLamports: "1000",
    accountingComplete: true,
    pending: null,
  });
});
it("rejects altered signed messages without saving or sending", async () => {
  const input = await signed();
  const tx = Transaction.from(Buffer.from(input.transaction, "base64"));
  tx.instructions[2].data[8] ^= 1;
  tx.partialSign(wallet);
  const response = await post("submit", {
    ...input,
    transaction: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  });
  expect(response.status).toBe(400);
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});
it("cannot expire or change journal against a switched RPC network", async () => {
  await post("submit", await signed());
  vi.mocked(rpc.getGenesisHash).mockResolvedValue("wrong");
  vi.mocked(rpc.getBlockHeight).mockResolvedValue(1000);
  expect((await post("status")).status).toBe(400);
  expect(journal().entries[0].state).toBe("pending");
});
it("stops approvals without finalized receipt and when an expired outcome has unknown fees", async () => {
  await post("submit", await signed());
  finalized = true;
  feeReceipt = false;
  expect((await post("status")).status).toBe(400);
  expect(journal().entries[0].state).toBe("pending");
  finalized = false;
  vi.mocked(rpc.getBlockHeight).mockResolvedValue(201);
  expect((await post("prepare")).body.error).toMatch(/no verified fee receipt/);
  expect(journal().entries[0].state).toBe("expired");
});
it("rejects negative fee quotes before wallet approval", async () => {
  vi.mocked(rpc.getFeeForMessage).mockResolvedValue({
    context: { slot: 1 },
    value: -1,
  });
  expect((await post("prepare")).status).toBe(400);
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});
it("keeps failed attempts reserved and refuses retries that consume the remaining deployment allowance", async () => {
  vi.mocked(rpc.getTransaction).mockImplementation(
    async () =>
      ({
        meta: { fee: 5000, preBalances: [100000], postBalances: [95000] },
        transaction: {
          message: { getAccountKeys: () => ({ get: () => wallet.publicKey }) },
        },
      }) as never,
  );
  for (let attempt = 0; attempt < 12; attempt++) {
    finalized = false;
    vi.mocked(rpc.getLatestBlockhash).mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 200,
    });
    await post("submit", await signed());
    finalized = true;
    vi.mocked(rpc.getSignatureStatuses).mockResolvedValueOnce({
      context: { slot: 1 },
      value: [
        {
          slot: 1,
          confirmations: null,
          confirmationStatus: "finalized",
          err: { InstructionError: [0, "InvalidArgument"] },
        },
      ],
    });
    expect((await post("status")).status).toBe(200);
  }
  const status = (await post("status")).body;
  expect(status).toMatchObject({
    reservedLamports: "72000",
    actualFeesLamports: "60000",
    netAccountFundingLamports: "0",
  });
  expect((await post("prepare")).body.error).toMatch(
    /remaining deployment allowance/,
  );
});

it("locks the state directory across console instances and releases on orderly close", async () => {
  await expect(startDeploymentConsole(startInput)).rejects.toThrow(
    "state is locked",
  );
  expect(statSync(join(directory, "console.lock")).mode & 0o077).toBe(0);
  await local.close();
  expect(existsSync(join(directory, "console.lock"))).toBe(false);
  local = await startDeploymentConsole(startInput);
});
it("cleans its lock on startup failure but never silently removes a stale lock", async () => {
  await local.close();
  vi.mocked(rpc.getGenesisHash).mockResolvedValueOnce("wrong");
  await expect(startDeploymentConsole(startInput)).rejects.toThrow("genesis");
  expect(existsSync(join(directory, "console.lock"))).toBe(false);
  writeFileSync(
    join(directory, "console.lock"),
    JSON.stringify({ pid: 999999, lockId: "stale" }),
    { mode: 0o600 },
  );
  await expect(startDeploymentConsole(startInput)).rejects.toThrow(
    "state is locked",
  );
  expect(existsSync(join(directory, "console.lock"))).toBe(true);
  unlinkSync(join(directory, "console.lock"));
  local = await startDeploymentConsole(startInput);
});
async function writeBatchFixture(length = 3000, budget = 1_000_000n) {
  await local.close();
  const artifact = Buffer.alloc(length, 9);
  Buffer.from([127, 69, 76, 70]).copy(artifact);
  startInput.artifact = artifact;
  startInput.manifest = createDeploymentManifest({
    network: "devnet",
    artifact,
    wallet: wallet.publicKey,
    program: startInput.localKeys.program.publicKey,
    buffer: startInput.localKeys.buffer.publicKey,
    maxTotalLamports: budget,
    maxFeePerTransactionLamports: 10_000n,
  });
  const data = Buffer.alloc(37 + length);
  data.writeUInt32LE(1);
  data[4] = 1;
  wallet.publicKey.toBuffer().copy(data, 5);
  vi.mocked(rpc.getMultipleAccountsInfo).mockImplementation(async (keys) =>
    keys.map((key) =>
      key.toBase58() === startInput.manifest.buffer
        ? {
            data,
            lamports: 1000,
            executable: false,
            rentEpoch: 0,
            owner: UPGRADEABLE_LOADER,
          }
        : null,
    ),
  );
  vi.mocked(rpc.getSignatureStatuses).mockImplementation(
    async (signatures) => ({
      context: { slot: 1 },
      value: signatures.map(() => null),
    }),
  );
  vi.mocked(rpc.getTransaction).mockImplementation(
    async () =>
      ({
        meta: { fee: 5000, preBalances: [100000], postBalances: [95000] },
        transaction: {
          message: { getAccountKeys: () => ({ get: () => wallet.publicKey }) },
        },
      }) as never,
  );
  local = await startDeploymentConsole(startInput);
  capability = new URL(
    JSON.parse(readFileSync(local.accessPath, "utf8")).url,
  ).hash.slice(1);
  return data;
}
async function signedBatch(size = 3) {
  const result = await post("prepare", { batchSize: size });
  expect(result.status).toBe(200);
  return {
    id: result.body.id,
    transactions: result.body.transactions.map(
      (item: { transaction: string }) => {
        const tx = Transaction.from(Buffer.from(item.transaction, "base64"));
        tx.partialSign(wallet);
        return tx.serialize().toString("base64");
      },
    ),
  };
}
it("requires all batch signatures and rejects a tampered final transaction before saving or sending any", async () => {
  await writeBatchFixture();
  const input = await signedBatch();
  expect(
    (
      await post("submit", {
        ...input,
        transactions: input.transactions.slice(0, 2),
      })
    ).status,
  ).toBe(400);
  const tx = Transaction.from(Buffer.from(input.transactions[2], "base64"));
  tx.instructions[2].data[16] ^= 1;
  tx.partialSign(wallet);
  expect(
    (
      await post("submit", {
        ...input,
        transactions: [
          ...input.transactions.slice(0, 2),
          tx.serialize().toString("base64"),
        ],
      })
    ).status,
  ).toBe(400);
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  expect(existsSync(join(directory, "journal.json"))).toBe(false);
});
it("journals a whole batch before sending, preserves partial sends across restart, and only rebroadcasts unresolved exact bytes", async () => {
  await writeBatchFixture();
  const input = await signedBatch();
  let sent = 0;
  vi.mocked(rpc.sendRawTransaction).mockImplementation(async (raw) => {
    expect(journal().entries).toHaveLength(3);
    const entry = journal().entries.find(
      (item: { signedTransaction: string }) =>
        item.signedTransaction === Buffer.from(raw).toString("base64"),
    );
    expect(entry).toBeTruthy();
    sent++;
    if (sent === 2) throw new Error("timeout");
    return entry.signature;
  });
  expect((await post("submit", input)).status).toBe(202);
  expect(sent).toBe(2);
  const saved = journal().entries;
  vi.mocked(rpc.getSignatureStatuses).mockImplementation(
    async (signatures) => ({
      context: { slot: 1 },
      value: signatures.map((signature) =>
        signature === saved[0].signature
          ? {
              slot: 1,
              confirmations: null,
              confirmationStatus: "finalized",
              err: null,
            }
          : null,
      ),
    }),
  );
  expect((await post("status")).body.pending.count).toBe(2);
  await local.close();
  local = await startDeploymentConsole(startInput);
  capability = new URL(
    JSON.parse(readFileSync(local.accessPath, "utf8")).url,
  ).hash.slice(1);
  expect((await post("prepare", { batchSize: 16 })).status).toBe(400);
  const replayed: string[] = [];
  vi.mocked(rpc.sendRawTransaction).mockImplementation(async (raw) => {
    const encoded = Buffer.from(raw).toString("base64");
    replayed.push(encoded);
    return saved.find(
      (item: { signedTransaction: string }) =>
        item.signedTransaction === encoded,
    ).signature;
  });
  expect((await post("rebroadcast")).status).toBe(200);
  expect(replayed).toEqual(
    saved
      .slice(1)
      .map((entry: { signedTransaction: string }) => entry.signedTransaction),
  );
  expect(journal().entries).toHaveLength(3);
  expect((await post("status")).body.reservedLamports).toBe("15000");
});
it("fails closed on missing batch statuses and preserves pending entries", async () => {
  await writeBatchFixture();
  const input = await signedBatch();
  await post("submit", input);
  vi.mocked(rpc.getSignatureStatuses).mockResolvedValue({
    context: { slot: 1 },
    value: [null],
  });
  expect((await post("status")).body.error).toMatch(
    /Incomplete transaction status/,
  );
  expect(
    journal().entries.every(
      (entry: { state: string }) => entry.state === "pending",
    ),
  ).toBe(true);
  expect((await post("prepare", { batchSize: 3 })).status).toBe(400);
});
it("bounds batch size and rejects any fee quote above the per-transaction ceiling", async () => {
  await writeBatchFixture(20000);
  expect((await post("prepare", { batchSize: 17 })).status).toBe(400);
  const valid = await post("prepare", { batchSize: 16 });
  expect(valid.body.count).toBe(16);
  expect(valid.body.reservedLamports).toBe("80000");
  vi.mocked(rpc.getFeeForMessage).mockResolvedValueOnce({
    context: { slot: 1 },
    value: 10001,
  });
  expect((await post("prepare", { batchSize: 16 })).status).toBe(400);
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});

it("keeps every failed batch fee reserved before evaluating the remaining deployment budget", async () => {
  await writeBatchFixture(3000, 65_000n);
  const input = await signedBatch();
  await post("submit", input);
  vi.mocked(rpc.getSignatureStatuses).mockImplementation(
    async (signatures) => ({
      context: { slot: 1 },
      value: signatures.map(() => ({
        slot: 1,
        confirmations: null,
        confirmationStatus: "finalized",
        err: { InstructionError: [0, "InvalidArgument"] },
      })),
    }),
  );
  const state = (await post("status")).body;
  expect(state).toMatchObject({
    pending: null,
    reservedLamports: "15000",
    actualFeesLamports: "15000",
  });
  expect((await post("prepare", { batchSize: 3 })).body.error).toMatch(
    /remaining deployment allowance/,
  );
});
