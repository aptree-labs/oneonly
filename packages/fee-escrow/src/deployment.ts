/** Loader-v3 deployment planning only. Never sends a transaction or accepts a user's secret key. */
import { createHash } from "node:crypto";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type Connection,
  type Keypair,
} from "@solana/web3.js";

export const UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const DEPLOYMENT_GENESIS = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
} as const;
const BUFFER_HEADER = 37,
  PROGRAM_SIZE = 36,
  PROGRAM_DATA_HEADER = 45;
const MAX_PROGRAM_BYTES = 10 * 1024 * 1024;
export const WRITE_CHUNK_BYTES = 900;
export type DeploymentManifest = {
  version: 1;
  network: keyof typeof DEPLOYMENT_GENESIS;
  genesis: string;
  artifactSha256: string;
  artifactBytes: number;
  maxDataBytes: number;
  program: string;
  buffer: string;
  wallet: string;
  maxTotalLamports: string;
  maxFeePerTransactionLamports: string;
  priorityMicroLamports: string;
};
export type DeploymentRpc = Pick<
  Connection,
  | "getGenesisHash"
  | "getMultipleAccountsInfo"
  | "getMinimumBalanceForRentExemption"
  | "getLatestBlockhash"
  | "getFeeForMessage"
  | "getSignatureStatuses"
  | "getBlockHeight"
>;
export type PendingDeployment = {
  signature: string;
  lastValidBlockHeight: number;
};
export type DeploymentStep = {
  kind: "create-buffer" | "write" | "deploy";
  offset?: number;
};
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const key = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const instruction = (data: Buffer, keys: TransactionInstruction["keys"]) =>
  new TransactionInstruction({ programId: UPGRADEABLE_LOADER, keys, data });
export const deploymentProgramData = (program: PublicKey) =>
  PublicKey.findProgramAddressSync([program.toBuffer()], UPGRADEABLE_LOADER)[0];
function amount(value: string) {
  if (
    !/^[0-9]+$/.test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Invalid deployment cost limit");
  return BigInt(value);
}
function artifactCheck(artifact: Uint8Array, expectedHash?: string) {
  if (
    artifact.length < 64 ||
    artifact.length > MAX_PROGRAM_BYTES ||
    !Buffer.from(artifact.subarray(0, 4)).equals(Buffer.from([127, 69, 76, 70]))
  )
    throw new Error("Expected a bounded ELF artifact");
  const sha = hash(artifact);
  if (expectedHash && sha !== expectedHash)
    throw new Error("Artifact SHA256 changed; create and review a new plan");
  return sha;
}
export function createDeploymentManifest(input: {
  network: DeploymentManifest["network"];
  artifact: Uint8Array;
  wallet: PublicKey;
  program: PublicKey;
  buffer: PublicKey;
  maxDataBytes?: number;
  maxTotalLamports: bigint;
  maxFeePerTransactionLamports: bigint;
  priorityMicroLamports?: bigint;
}): DeploymentManifest {
  const result: DeploymentManifest = {
    version: 1,
    network: input.network,
    genesis: DEPLOYMENT_GENESIS[input.network],
    artifactSha256: artifactCheck(input.artifact),
    artifactBytes: input.artifact.length,
    maxDataBytes: input.maxDataBytes ?? input.artifact.length,
    program: input.program.toBase58(),
    buffer: input.buffer.toBase58(),
    wallet: input.wallet.toBase58(),
    maxTotalLamports: String(input.maxTotalLamports),
    maxFeePerTransactionLamports: String(input.maxFeePerTransactionLamports),
    priorityMicroLamports: String(input.priorityMicroLamports ?? 0n),
  };
  validateDeploymentManifest(result, input.artifact);
  return result;
}
export function validateDeploymentManifest(
  m: DeploymentManifest,
  artifact?: Uint8Array,
) {
  if (
    m.version !== 1 ||
    !(m.network in DEPLOYMENT_GENESIS) ||
    m.genesis !== DEPLOYMENT_GENESIS[m.network]
  )
    throw new Error("Unsupported deployment network or manifest");
  if (
    !/^[a-f0-9]{64}$/.test(m.artifactSha256) ||
    !Number.isSafeInteger(m.artifactBytes) ||
    m.artifactBytes < 64 ||
    m.artifactBytes > MAX_PROGRAM_BYTES ||
    !Number.isSafeInteger(m.maxDataBytes) ||
    m.maxDataBytes < m.artifactBytes ||
    m.maxDataBytes > MAX_PROGRAM_BYTES
  )
    throw new Error("Invalid artifact size or digest");
  const keys = [m.program, m.buffer, m.wallet].map((k) => new PublicKey(k));
  if (
    new Set(keys.map((k) => k.toBase58())).size !== 3 ||
    keys.some((k) => !PublicKey.isOnCurve(k.toBytes()))
  )
    throw new Error("Program, buffer and wallet must be distinct signing keys");
  if (
    amount(m.maxTotalLamports) <= 0n ||
    amount(m.maxFeePerTransactionLamports) <= 0n ||
    amount(m.priorityMicroLamports) > 1_000_000n
  )
    throw new Error("Deployment costs require positive bounded limits");
  if (artifact) {
    artifactCheck(artifact, m.artifactSha256);
    if (artifact.length !== m.artifactBytes)
      throw new Error("Artifact size changed");
  }
}
/** Explicit allowlist prevents accidental Keypair/secret fields leaking into exported manifests. */
export function serializeDeploymentManifest(m: DeploymentManifest) {
  validateDeploymentManifest(m);
  return JSON.stringify(
    {
      version: m.version,
      network: m.network,
      genesis: m.genesis,
      artifactSha256: m.artifactSha256,
      artifactBytes: m.artifactBytes,
      maxDataBytes: m.maxDataBytes,
      program: m.program,
      buffer: m.buffer,
      wallet: m.wallet,
      maxTotalLamports: m.maxTotalLamports,
      maxFeePerTransactionLamports: m.maxFeePerTransactionLamports,
      priorityMicroLamports: m.priorityMicroLamports,
    },
    null,
    2,
  );
}
async function networkCheck(rpc: DeploymentRpc, m: DeploymentManifest) {
  validateDeploymentManifest(m);
  if ((await rpc.getGenesisHash()) !== m.genesis)
    throw new Error("RPC genesis does not match the approved network");
}
function owned(account: AccountInfo<Buffer>, size: number, tag: number) {
  if (
    !account.owner.equals(UPGRADEABLE_LOADER) ||
    account.data.length !== size ||
    account.data.readUInt32LE(0) !== tag
  )
    throw new Error("Unexpected loader account type, owner or size");
}
function validateBuffer(account: AccountInfo<Buffer>, m: DeploymentManifest) {
  owned(account, BUFFER_HEADER + m.artifactBytes, 1);
  if (
    account.executable ||
    account.data[4] !== 1 ||
    !new PublicKey(account.data.subarray(5, 37)).equals(new PublicKey(m.wallet))
  )
    throw new Error("Buffer authority does not match the external wallet");
}
export async function inspectDeployment(
  rpc: DeploymentRpc,
  m: DeploymentManifest,
  artifact: Uint8Array,
) {
  validateDeploymentManifest(m, artifact);
  await networkCheck(rpc, m);
  const program = new PublicKey(m.program),
    buffer = new PublicKey(m.buffer),
    pd = deploymentProgramData(program);
  const [programAccount, bufferAccount, programData] =
    await rpc.getMultipleAccountsInfo([program, buffer, pd], "finalized");
  if (bufferAccount) validateBuffer(bufferAccount, m);
  if (programAccount) {
    owned(programAccount, PROGRAM_SIZE, 2);
    if (
      !programAccount.executable ||
      !new PublicKey(programAccount.data.subarray(4, 36)).equals(pd) ||
      !programData
    )
      throw new Error("Program is not the expected deployed executable");
    owned(programData, PROGRAM_DATA_HEADER + m.maxDataBytes, 3);
    if (
      programData.data[12] !== 1 ||
      !new PublicKey(programData.data.subarray(13, 45)).equals(
        new PublicKey(m.wallet),
      )
    )
      throw new Error("Program upgrade authority mismatch");
    if (
      hash(
        programData.data.subarray(
          PROGRAM_DATA_HEADER,
          PROGRAM_DATA_HEADER + m.artifactBytes,
        ),
      ) !== m.artifactSha256 ||
      programData.data
        .subarray(PROGRAM_DATA_HEADER + m.artifactBytes)
        .some((b) => b !== 0)
    )
      throw new Error("Deployed artifact differs from reviewed bytes");
    return {
      complete: true,
      next: null,
      missingChunks: [] as number[],
      recoverableBufferLamports: bufferAccount?.lamports ?? 0,
    };
  }
  if (programData) throw new Error("Unexpected existing ProgramData account");
  const missingChunks: number[] = [];
  for (let offset = 0; offset < m.artifactBytes; offset += WRITE_CHUNK_BYTES) {
    const bytes = Buffer.from(
      artifact.subarray(offset, offset + WRITE_CHUNK_BYTES),
    );
    if (
      !bufferAccount ||
      !bufferAccount.data
        .subarray(BUFFER_HEADER + offset, BUFFER_HEADER + offset + bytes.length)
        .equals(bytes)
    )
      missingChunks.push(offset);
  }
  const next: DeploymentStep = !bufferAccount
    ? { kind: "create-buffer" }
    : missingChunks.length
      ? { kind: "write", offset: missingChunks[0] }
      : { kind: "deploy" };
  return {
    complete: false,
    next,
    missingChunks,
    recoverableBufferLamports: bufferAccount?.lamports ?? 0,
  };
}
/** Conservative peak cash requirement; includes refundable buffer rent and a fee allowance for every step. */
export async function deploymentCosts(
  rpc: DeploymentRpc,
  m: DeploymentManifest,
) {
  await networkCheck(rpc, m);
  const rents = await Promise.all(
    [
      BUFFER_HEADER + m.artifactBytes,
      PROGRAM_SIZE,
      PROGRAM_DATA_HEADER + m.maxDataBytes,
    ].map((size) => rpc.getMinimumBalanceForRentExemption(size, "finalized")),
  );
  if (rents.some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new Error("Invalid RPC rent estimate");
  const transactions = Math.ceil(m.artifactBytes / WRITE_CHUNK_BYTES) + 2;
  const feeAllowance =
    BigInt(transactions) * amount(m.maxFeePerTransactionLamports);
  const rent = rents.reduce((n, x) => n + BigInt(x), 0n),
    upperBound = rent + feeAllowance;
  if (upperBound > amount(m.maxTotalLamports))
    throw new Error("Deployment estimate exceeds approved total cost limit");
  return {
    bufferRent: rents[0],
    programRent: rents[1],
    programDataRent: rents[2],
    transactions,
    feeAllowance: String(feeAllowance),
    conservativeTotalLamports: String(upperBound),
  };
}
/** Do not replace an unknown in-flight transaction. The wallet adapter must persist this journal before broadcast. */
async function pendingCheck(rpc: DeploymentRpc, pending?: PendingDeployment) {
  if (!pending) return;
  if (
    !pending.signature ||
    !Number.isSafeInteger(pending.lastValidBlockHeight) ||
    pending.lastValidBlockHeight < 0
  )
    throw new Error("Invalid pending transaction journal");
  const status = (
    await rpc.getSignatureStatuses([pending.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (status?.confirmationStatus === "finalized") return;
  if (status)
    throw new Error(
      "Wait for the pending transaction to finalize before replanning",
    );
  if ((await rpc.getBlockHeight("finalized")) <= pending.lastValidBlockHeight)
    throw new Error(
      "Transaction outcome is unknown; rebroadcast the same signed bytes or wait for expiry",
    );
}
function signingGate(m: DeploymentManifest) {
  if (m.network !== "devnet")
    throw new Error(
      "Mainnet signing is disabled pending validated release readiness; rehearse on devnet first",
    );
}
async function finish(
  rpc: DeploymentRpc,
  m: DeploymentManifest,
  instructions: TransactionInstruction[],
  localSigners: Keypair[],
) {
  const latest = await rpc.getLatestBlockhash("finalized");
  const transaction = new Transaction({
    feePayer: new PublicKey(m.wallet),
    ...latest,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: amount(m.priorityMicroLamports),
    }),
    ...instructions,
  );
  const fee = (
    await rpc.getFeeForMessage(transaction.compileMessage(), "finalized")
  ).value;
  if (
    fee === null ||
    !Number.isSafeInteger(fee) ||
    fee < 0 ||
    BigInt(fee) > amount(m.maxFeePerTransactionLamports)
  )
    throw new Error(
      "Transaction fee exceeds approved ceiling or is unavailable",
    );
  if (localSigners.length) transaction.partialSign(...localSigners);
  if (transaction.serialize({ requireAllSignatures: false }).length > 1232)
    throw new Error("Deployment transaction exceeds packet size");
  return {
    transaction,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    feeLamports: fee,
    messageSha256: hash(transaction.serializeMessage()),
    walletSignatureRequired: true as const,
  };
}
export async function prepareNextDeployment(input: {
  rpc: DeploymentRpc;
  manifest: DeploymentManifest;
  artifact: Uint8Array;
  localKeys: { program: Keypair; buffer: Keypair };
  pending?: PendingDeployment;
}) {
  const { rpc, manifest: m, artifact, localKeys } = input;
  validateDeploymentManifest(m, artifact);
  signingGate(m);
  if (
    localKeys.program.publicKey.toBase58() !== m.program ||
    localKeys.buffer.publicKey.toBase58() !== m.buffer
  )
    throw new Error("Local creation keys do not match the public plan");
  await networkCheck(rpc, m);
  await pendingCheck(rpc, input.pending);
  const state = await inspectDeployment(rpc, m, artifact);
  if (!state.next) return { complete: true as const };
  const cost = await deploymentCosts(rpc, m),
    wallet = new PublicKey(m.wallet),
    buffer = new PublicKey(m.buffer),
    program = new PublicKey(m.program);
  const instructions: TransactionInstruction[] = [],
    signers: Keypair[] = [];
  switch (state.next.kind) {
    case "create-buffer":
      instructions.push(
        SystemProgram.createAccount({
          fromPubkey: wallet,
          newAccountPubkey: buffer,
          lamports: cost.bufferRent,
          space: BUFFER_HEADER + m.artifactBytes,
          programId: UPGRADEABLE_LOADER,
        }),
        instruction(u32(0), [key(buffer, true), key(wallet)]),
      );
      signers.push(localKeys.buffer);
      break;
    case "write": {
      const offset = state.next.offset!,
        bytes = Buffer.from(
          artifact.subarray(offset, offset + WRITE_CHUNK_BYTES),
        );
      instructions.push(
        instruction(
          Buffer.concat([
            u32(1),
            u32(offset),
            u64(BigInt(bytes.length)),
            bytes,
          ]),
          [key(buffer, true), key(wallet, false, true)],
        ),
      );
      break;
    }
    case "deploy":
      instructions.push(
        SystemProgram.createAccount({
          fromPubkey: wallet,
          newAccountPubkey: program,
          lamports: cost.programRent,
          space: PROGRAM_SIZE,
          programId: UPGRADEABLE_LOADER,
        }),
        instruction(Buffer.concat([u32(2), u64(BigInt(m.maxDataBytes))]), [
          key(wallet, true, true),
          key(deploymentProgramData(program), true),
          key(program, true),
          key(buffer, true),
          key(SYSVAR_RENT_PUBKEY),
          key(SYSVAR_CLOCK_PUBKEY),
          key(SystemProgram.programId),
          key(wallet, false, true),
        ]),
      );
      signers.push(localKeys.program);
      break;
  }
  return {
    complete: false as const,
    step: state.next,
    ...(await finish(rpc, m, instructions, signers)),
  };
}
/** Recovery can only close this manifest's Buffer; never Program/ProgramData or fee escrows. */
export async function prepareBufferRecovery(
  rpc: DeploymentRpc,
  m: DeploymentManifest,
  pending?: PendingDeployment,
) {
  validateDeploymentManifest(m);
  signingGate(m);
  await networkCheck(rpc, m);
  await pendingCheck(rpc, pending);
  const buffer = new PublicKey(m.buffer),
    wallet = new PublicKey(m.wallet);
  const [account] = await rpc.getMultipleAccountsInfo([buffer], "finalized");
  if (!account) return null;
  validateBuffer(account, m);
  return {
    refundableLamports: account.lamports,
    ...(await finish(
      rpc,
      m,
      [
        instruction(u32(5), [
          key(buffer, true),
          key(wallet, true),
          key(wallet, false, true),
        ]),
      ],
      [],
    )),
  };
}
/** Wallet fee adjustment is not accepted for deployment: every signed message must match the reviewed bytes. */
export function assertDeploymentWalletSignature(
  transaction: Transaction,
  expectedMessageSha256: string,
  wallet: PublicKey,
) {
  if (
    !transaction.feePayer?.equals(wallet) ||
    hash(transaction.serializeMessage()) !== expectedMessageSha256 ||
    !transaction.verifySignatures()
  )
    throw new Error(
      "Wallet returned an altered or incompletely signed deployment transaction",
    );
}
