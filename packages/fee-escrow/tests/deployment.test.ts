import { prepareDeploymentBatch } from "../src/deployment";
import { beforeEach, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
} from "@solana/web3.js";
import {
  UPGRADEABLE_LOADER,
  DEPLOYMENT_GENESIS,
  WRITE_CHUNK_BYTES,
  createDeploymentManifest,
  serializeDeploymentManifest,
  inspectDeployment,
  deploymentCosts,
  deploymentProgramData,
  prepareNextDeployment,
  prepareBufferRecovery,
  assertDeploymentWalletSignature,
  type DeploymentManifest,
  type DeploymentRpc,
} from "../src/deployment";
let wallet: Keypair,
  program: Keypair,
  buffer: Keypair,
  artifact: Buffer,
  manifest: DeploymentManifest;
let accounts: Map<string, AccountInfo<Buffer>>;
let rpc: DeploymentRpc;
const info = (data: Buffer): AccountInfo<Buffer> => ({
  data,
  lamports: 1000,
  owner: UPGRADEABLE_LOADER,
  executable: false,
  rentEpoch: 0,
});
function bufferInfo() {
  const data = Buffer.alloc(37 + artifact.length);
  data.writeUInt32LE(1);
  data[4] = 1;
  wallet.publicKey.toBuffer().copy(data, 5);
  return info(data);
}
beforeEach(() => {
  wallet = Keypair.generate();
  program = Keypair.generate();
  buffer = Keypair.generate();
  artifact = Buffer.alloc(1950, 7);
  Buffer.from([127, 69, 76, 70]).copy(artifact);
  manifest = createDeploymentManifest({
    network: "devnet",
    artifact,
    wallet: wallet.publicKey,
    program: program.publicKey,
    buffer: buffer.publicKey,
    maxTotalLamports: 1_000_000n,
    maxFeePerTransactionLamports: 10_000n,
  });
  accounts = new Map();
  rpc = {
    getGenesisHash: vi.fn().mockResolvedValue(DEPLOYMENT_GENESIS.devnet),
    getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) =>
      keys.map((k) => accounts.get(k.toBase58()) ?? null),
    ),
    getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(1000),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 200,
    }),
    getFeeForMessage: vi
      .fn()
      .mockResolvedValue({ context: { slot: 1 }, value: 5000 }),
    getSignatureStatuses: vi
      .fn()
      .mockResolvedValue({ context: { slot: 1 }, value: [null] }),
    getBlockHeight: vi.fn().mockResolvedValue(100),
  } as unknown as DeploymentRpc;
});
const next = (pending?: { signature: string; lastValidBlockHeight: number }) =>
  prepareNextDeployment({
    rpc,
    manifest,
    artifact,
    localKeys: { program, buffer },
    pending,
  });
it("creates only public manifests and binds artifact, network and distinct authorities", () => {
  const exported = serializeDeploymentManifest({
    ...manifest,
    secretKey: [1, 2],
    localKeys: { wallet },
  } as DeploymentManifest);
  expect(exported).not.toMatch(/secretKey|localKeys/);
  expect(JSON.parse(exported).artifactSha256).toHaveLength(64);
  expect(() =>
    createDeploymentManifest({
      network: "devnet",
      artifact,
      wallet: wallet.publicKey,
      program: wallet.publicKey,
      buffer: buffer.publicKey,
      maxTotalLamports: 1n,
      maxFeePerTransactionLamports: 1n,
    }),
  ).toThrow("distinct");
});
it("plans atomic buffer initialization, resumes matching chunks, then atomic program deployment", async () => {
  const first = await next();
  expect(first.complete).toBe(false);
  if (first.complete) return;
  expect(first.step.kind).toBe("create-buffer");
  expect(
    first.transaction.instructions[2].programId.equals(SystemProgram.programId),
  ).toBe(true);
  expect(first.transaction.instructions[3].data.readUInt32LE(0)).toBe(0);
  expect(
    first.transaction.instructions[3].keys[1].pubkey.equals(wallet.publicKey),
  ).toBe(true);
  expect(
    first.transaction.signatures.find((s) =>
      s.publicKey.equals(buffer.publicKey),
    )?.signature,
  ).not.toBeNull();
  expect(
    first.transaction.signatures.find((s) =>
      s.publicKey.equals(wallet.publicKey),
    )?.signature,
  ).toBeNull();
  const account = bufferInfo();
  accounts.set(manifest.buffer, account);
  for (let offset = 0; offset < artifact.length; offset += WRITE_CHUNK_BYTES) {
    const step = await next();
    if (step.complete) throw new Error("Premature completion");
    expect(step.step).toEqual({ kind: "write", offset });
    const write = step.transaction.instructions[2];
    expect(write.data.readUInt32LE(0)).toBe(1);
    expect(write.data.readUInt32LE(4)).toBe(offset);
    expect(Number(write.data.readBigUInt64LE(8))).toBe(
      Math.min(WRITE_CHUNK_BYTES, artifact.length - offset),
    );
    expect(write.keys[1]).toMatchObject({ isSigner: true, isWritable: false });
    write.data.subarray(16).copy(account.data, 37 + offset);
    expect(
      step.transaction.serialize({ requireAllSignatures: false }).length,
    ).toBeLessThanOrEqual(1232);
  }
  const deploy = await next();
  if (deploy.complete) throw new Error("Missing deploy step");
  expect(deploy.step.kind).toBe("deploy");
  const instruction = deploy.transaction.instructions[3];
  expect(instruction.data.readUInt32LE(0)).toBe(2);
  expect(instruction.data.readBigUInt64LE(4)).toBe(BigInt(artifact.length));
  expect(instruction.keys.map((k) => [k.isWritable, k.isSigner])).toEqual([
    [true, true],
    [true, false],
    [true, false],
    [true, false],
    [false, false],
    [false, false],
    [false, false],
    [false, true],
  ]);
  expect(instruction.keys[7].pubkey.equals(wallet.publicKey)).toBe(true);
  expect(
    deploy.transaction.signatures.find((s) =>
      s.publicKey.equals(program.publicKey),
    )?.signature,
  ).not.toBeNull();
});
it("accepts completion only with exact deployed bytes, ProgramData and external upgrade authority", async () => {
  const pd = deploymentProgramData(program.publicKey);
  const programData = Buffer.alloc(45 + artifact.length);
  programData.writeUInt32LE(3);
  programData[12] = 1;
  wallet.publicKey.toBuffer().copy(programData, 13);
  artifact.copy(programData, 45);
  const p = Buffer.alloc(36);
  p.writeUInt32LE(2);
  pd.toBuffer().copy(p, 4);
  accounts.set(manifest.program, { ...info(p), executable: true });
  accounts.set(pd.toBase58(), info(programData));
  expect((await inspectDeployment(rpc, manifest, artifact)).complete).toBe(
    true,
  );
  programData[45] ^= 1;
  await expect(inspectDeployment(rpc, manifest, artifact)).rejects.toThrow(
    "artifact",
  );
  programData[45] ^= 1;
  programData[13] ^= 1;
  await expect(inspectDeployment(rpc, manifest, artifact)).rejects.toThrow(
    "authority",
  );
});
it("refuses wrong genesis, changed artifact, exceeded rents/fees and all mainnet signing", async () => {
  vi.mocked(rpc.getGenesisHash).mockResolvedValueOnce("wrong");
  await expect(next()).rejects.toThrow("genesis");
  artifact[80] ^= 1;
  await expect(next()).rejects.toThrow("SHA256");
  artifact[80] ^= 1;
  await expect(
    deploymentCosts(rpc, { ...manifest, maxTotalLamports: "1" }),
  ).rejects.toThrow("cost limit");
  vi.mocked(rpc.getFeeForMessage).mockResolvedValueOnce({
    context: { slot: 1 },
    value: 20000,
  });
  await expect(next()).rejects.toThrow("fee");
  manifest = {
    ...manifest,
    network: "mainnet-beta",
    genesis: DEPLOYMENT_GENESIS["mainnet-beta"],
  };
  await expect(next()).rejects.toThrow("Mainnet signing");
  await expect(prepareBufferRecovery(rpc, manifest)).rejects.toThrow(
    "Mainnet signing",
  );
});
it("never replaces an unknown nonexpired transaction; resumes after finalized expiry", async () => {
  const pending = {
    signature: "recorded-signature",
    lastValidBlockHeight: 200,
  };
  await expect(next(pending)).rejects.toThrow("unknown");
  vi.mocked(rpc.getBlockHeight).mockResolvedValue(201);
  expect((await next(pending)).complete).toBe(false);
  vi.mocked(rpc.getSignatureStatuses).mockResolvedValue({
    context: { slot: 1 },
    value: [
      { slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" },
    ],
  });
  await expect(next(pending)).rejects.toThrow("finalize");
});
it("refunds only an authenticated buffer to the external payer, never program accounts", async () => {
  expect(await prepareBufferRecovery(rpc, manifest)).toBeNull();
  const a = bufferInfo();
  accounts.set(manifest.buffer, a);
  const recovery = await prepareBufferRecovery(rpc, manifest);
  expect(recovery?.refundableLamports).toBe(1000);
  const ix = recovery!.transaction.instructions[2];
  expect(ix.data.readUInt32LE(0)).toBe(5);
  expect(ix.keys[1].pubkey.equals(wallet.publicKey)).toBe(true);
  expect(ix.keys[2].isSigner).toBe(true);
  a.data[5] ^= 1;
  await expect(prepareBufferRecovery(rpc, manifest)).rejects.toThrow(
    "authority",
  );
  a.data[5] ^= 1;
  a.data.writeUInt32LE(3);
  await expect(prepareBufferRecovery(rpc, manifest)).rejects.toThrow("type");
});
it("requires unchanged fully signed messages from the external wallet", async () => {
  const step = await next();
  if (step.complete) throw new Error("Missing step");
  expect(() =>
    assertDeploymentWalletSignature(
      step.transaction,
      step.messageSha256,
      wallet.publicKey,
    ),
  ).toThrow();
  step.transaction.partialSign(wallet);
  expect(() =>
    assertDeploymentWalletSignature(
      step.transaction,
      step.messageSha256,
      wallet.publicKey,
    ),
  ).not.toThrow();
  const changed = Transaction.from(step.transaction.serialize());
  changed.instructions[0].data[1] ^= 1;
  expect(() =>
    assertDeploymentWalletSignature(
      changed,
      step.messageSha256,
      wallet.publicKey,
    ),
  ).toThrow("altered");
});

it("batches only independent missing writes with one shared expiry and exact artifact offsets", async () => {
  const account = bufferInfo();
  accounts.set(manifest.buffer, account);
  artifact.subarray(900, 1800).copy(account.data, 37 + 900);
  const batch = await prepareDeploymentBatch({
    rpc,
    manifest,
    artifact,
    localKeys: { program, buffer },
    batchSize: 16,
  });
  expect(batch.items.map((item) => item.step)).toEqual([
    { kind: "write", offset: 0 },
    { kind: "write", offset: 1800 },
  ]);
  expect(rpc.getLatestBlockhash).toHaveBeenCalledTimes(1);
  expect(
    new Set(batch.items.map((item) => item.transaction.recentBlockhash)).size,
  ).toBe(1);
  for (const item of batch.items) {
    expect(item.lastValidBlockHeight).toBe(200);
    const write = item.transaction.instructions[2];
    const offset = write.data.readUInt32LE(4);
    expect(write.data.subarray(16)).toEqual(
      artifact.subarray(offset, offset + 900),
    );
  }
  accounts.clear();
  const create = await prepareDeploymentBatch({
    rpc,
    manifest,
    artifact,
    localKeys: { program, buffer },
    batchSize: 16,
  });
  expect(create.items).toHaveLength(1);
  expect(create.items[0].step.kind).toBe("create-buffer");
  await expect(
    prepareDeploymentBatch({
      rpc,
      manifest,
      artifact,
      localKeys: { program, buffer },
      batchSize: 17,
    }),
  ).rejects.toThrow("between 1 and 16");
});
