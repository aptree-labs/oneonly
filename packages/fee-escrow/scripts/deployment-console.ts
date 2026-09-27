/** Local devnet-only signing bridge. Never accepts an external-wallet private key. */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
  openSync,
  fsyncSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import {
  PublicKey,
  Transaction,
  type Keypair,
  type Connection,
} from "@solana/web3.js";
import {
  type DeploymentManifest,
  type DeploymentRpc,
  serializeDeploymentManifest,
  validateDeploymentManifest,
  inspectDeployment,
  deploymentCosts,
  prepareNextDeployment,
  prepareBufferRecovery,
  assertDeploymentWalletSignature,
} from "../src/deployment";
export type ConsoleRpc = DeploymentRpc &
  Pick<Connection, "getTransaction"> & {
    sendRawTransaction: (
      bytes: Uint8Array,
      options: { skipPreflight: boolean; maxRetries: number },
    ) => Promise<string>;
  };
type Entry = {
  kind: string;
  signature: string;
  signedTransaction: string;
  lastValidBlockHeight: number;
  reservedLamports: string;
  actualFeeLamports?: string;
  netAccountFundingLamports?: string;
  state: "pending" | "finalized" | "failed" | "expired";
};
type Journal = { version: 1; planHash: string; entries: Entry[] };
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function savePrivateJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  const file = openSync(temp, "r");
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  renameSync(temp, path);
  chmodSync(path, 0o600);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function signatureText(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex")}`),
    result = "";
  while (number) {
    result = alphabet[Number(number % 58n)] + result;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result;
}
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error("Request too large");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function reply(response: ServerResponse, code: number, value: unknown) {
  response.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
export async function startDeploymentConsole(input: {
  rpc: ConsoleRpc;
  manifest: DeploymentManifest;
  artifact: Buffer;
  localKeys: { program: Keypair; buffer: Keypair };
  stateDirectory: string;
}) {
  const { rpc, manifest, artifact, localKeys, stateDirectory } = input;
  validateDeploymentManifest(manifest, artifact);
  if (manifest.network !== "devnet")
    throw new Error(
      "Wallet deployment console is devnet-only; mainnet readiness has not been approved",
    );
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const lockPath = join(stateDirectory, "console.lock");
  const lockId = randomBytes(32).toString("hex");
  let lockReleased = false;
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    try {
      writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          lockId,
        }),
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new Error(
      "Deployment state is locked. Close its active console; after a crash, explicitly reconcile the journal before removing the stale lock.",
    );
  }
  const releaseLock = () => {
    if (lockReleased) return;
    if (JSON.parse(readFileSync(lockPath, "utf8")).lockId !== lockId)
      throw new Error(
        "Deployment lock changed unexpectedly; manual reconciliation required",
      );
    unlinkSync(lockPath);
    lockReleased = true;
  };
  let openedServer: ReturnType<typeof createServer> | undefined;
  try {
    await inspectDeployment(rpc, manifest, artifact);
    const costs = await deploymentCosts(rpc, manifest);
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    const manifestText = serializeDeploymentManifest(manifest),
      planHash = sha(manifestText),
      journalPath = join(stateDirectory, "journal.json");
    const journal: Journal = existsSync(journalPath)
      ? JSON.parse(readFileSync(journalPath, "utf8"))
      : { version: 1, planHash, entries: [] };
    if (
      journal.version !== 1 ||
      journal.planHash !== planHash ||
      !Array.isArray(journal.entries)
    )
      throw new Error("Deployment journal belongs to a different plan");
    for (const item of journal.entries) {
      const transaction = Transaction.from(
        Buffer.from(item.signedTransaction, "base64"),
      );
      if (
        !transaction.verifySignatures() ||
        !transaction.feePayer?.equals(new PublicKey(manifest.wallet)) ||
        !transaction.signature ||
        signatureText(transaction.signature) !== item.signature ||
        !/^[0-9]+$/.test(item.reservedLamports)
      )
        throw new Error("Invalid saved deployment journal");
    }
    const capability = randomBytes(32).toString("hex");
    let origin = "",
      busy = false;
    let prepared: {
      id: string;
      kind: string;
      bytes: string;
      messageHash: string;
      lastValidBlockHeight: number;
      reserve: bigint;
    } | null = null;
    const persist = () => savePrivateJson(journalPath, journal);
    const spent = () =>
      journal.entries.reduce((n, e) => n + BigInt(e.reservedLamports), 0n);
    const pending = () =>
      [...journal.entries].reverse().find((e) => e.state === "pending");
    async function refreshPending() {
      if ((await rpc.getGenesisHash()) !== manifest.genesis)
        throw new Error("RPC network changed");
      const item = pending();
      if (!item) return;
      const status = (
        await rpc.getSignatureStatuses([item.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (status?.confirmationStatus === "finalized") {
        const receipt = await rpc.getTransaction(item.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
        if (
          !receipt?.meta ||
          !Number.isSafeInteger(receipt.meta.fee) ||
          receipt.meta.fee < 0
        )
          throw new Error(
            "Finalized fee receipt is unavailable. Stop until accounting can be verified.",
          );
        const pre = receipt.meta.preBalances[0],
          post = receipt.meta.postBalances[0];
        if (
          !Number.isSafeInteger(pre) ||
          !Number.isSafeInteger(post) ||
          pre < 0 ||
          post < 0
        )
          throw new Error("Invalid finalized wallet balance receipt");
        const message = receipt.transaction.message;
        const payer = message.getAccountKeys().get(0);
        if (payer?.toBase58() !== manifest.wallet)
          throw new Error("Finalized receipt fee payer mismatch");
        item.actualFeeLamports = String(receipt.meta.fee);
        item.netAccountFundingLamports = String(
          BigInt(pre) - BigInt(post) - BigInt(receipt.meta.fee),
        );
        item.state = status.err ? "failed" : "finalized";
        persist();
        if (
          BigInt(receipt.meta.fee) >
            BigInt(manifest.maxFeePerTransactionLamports) ||
          BigInt(pre) - BigInt(post) > BigInt(item.reservedLamports)
        )
          throw new Error(
            "Finalized spend exceeded the approved reservation. Stop and investigate.",
          );
      } else if (
        !status &&
        (await rpc.getBlockHeight("finalized")) > item.lastValidBlockHeight
      ) {
        item.state = "expired";
        persist();
      }
    }
    async function status() {
      await refreshPending();
      const chain = await inspectDeployment(rpc, manifest, artifact);
      return {
        manifest,
        planHash,
        costs,
        complete: chain.complete,
        next: chain.next,
        missingChunks: chain.missingChunks.length,
        refundableLamports: chain.recoverableBufferLamports,
        reservedLamports: String(spent()),
        actualFeesLamports: String(
          journal.entries.reduce(
            (n, e) => n + BigInt(e.actualFeeLamports ?? "0"),
            0n,
          ),
        ),
        netAccountFundingLamports: String(
          journal.entries.reduce(
            (n, e) => n + BigInt(e.netAccountFundingLamports ?? "0"),
            0n,
          ),
        ),
        accountingComplete: journal.entries.every(
          (e) => e.actualFeeLamports !== undefined,
        ),
        pending: pending()
          ? { kind: pending()!.kind, signature: pending()!.signature }
          : null,
        lastState: journal.entries.at(-1)?.state ?? null,
      };
    }
    async function prepare(recover: boolean) {
      await refreshPending();
      if (pending())
        throw new Error(
          "A signed transaction is still pending. Check or rebroadcast it before another approval.",
        );
      if (
        journal.entries.some(
          (e) =>
            e.state === "expired" ||
            ((e.state === "finalized" || e.state === "failed") &&
              e.actualFeeLamports === undefined),
        )
      )
        throw new Error(
          "A previous attempt has no verified fee receipt. Stop and reconcile the journal before another approval.",
        );
      if (
        journal.entries.some(
          (e) =>
            e.actualFeeLamports !== undefined &&
            (BigInt(e.actualFeeLamports) >
              BigInt(manifest.maxFeePerTransactionLamports) ||
              BigInt(e.actualFeeLamports) +
                BigInt(e.netAccountFundingLamports ?? "0") >
                BigInt(e.reservedLamports)),
        )
      )
        throw new Error(
          "Previous spend exceeded its reservation; operator review required",
        );
      const chain = await inspectDeployment(rpc, manifest, artifact);
      const futureAllowance = chain.complete
        ? 0n
        : BigInt(
            chain.missingChunks.length +
              1 +
              (chain.next?.kind === "create-buffer" ? 1 : 0),
          ) *
            BigInt(manifest.maxFeePerTransactionLamports) +
          BigInt(costs.programRent) +
          BigInt(costs.programDataRent) +
          (chain.next?.kind === "create-buffer"
            ? BigInt(costs.bufferRent)
            : 0n);
      if (
        !recover &&
        spent() + futureAllowance > BigInt(manifest.maxTotalLamports)
      )
        throw new Error(
          "Reserved attempts plus remaining deployment allowance exceed the total budget. Review a new plan.",
        );
      const result = recover
        ? await prepareBufferRecovery(rpc, manifest)
        : await prepareNextDeployment({ rpc, manifest, artifact, localKeys });
      if (!result || ("complete" in result && result.complete)) {
        prepared = null;
        return { complete: true };
      }
      const kind = "step" in result ? result.step.kind : "recover-buffer";
      const funding =
        kind === "create-buffer"
          ? BigInt(costs.bufferRent)
          : kind === "deploy"
            ? BigInt(costs.programRent + costs.programDataRent)
            : 0n;
      // Keep failed/expired reservations too: never silently replenish the approval budget.
      const reserve = funding + BigInt(result.feeLamports);
      if (spent() + reserve > BigInt(manifest.maxTotalLamports))
        throw new Error(
          "This approval would exceed the deployment budget. Stop and review a new plan.",
        );
      prepared = {
        id: randomBytes(24).toString("hex"),
        kind,
        bytes: result.transaction
          .serialize({ requireAllSignatures: false })
          .toString("base64"),
        messageHash: result.messageSha256,
        lastValidBlockHeight: result.lastValidBlockHeight,
        reserve,
      };
      return {
        id: prepared.id,
        kind,
        transaction: prepared.bytes,
        messageSha256: prepared.messageHash,
        feeLamports: result.feeLamports,
        maximumFundingLamports: String(funding),
        reservedLamports: String(reserve),
        wallet: manifest.wallet,
        planHash,
      };
    }
    const server = createServer(async (request, response) => {
      if (
        request.headers.host !== new URL(origin).host ||
        !["127.0.0.1", "::ffff:127.0.0.1"].includes(
          request.socket.remoteAddress ?? "",
        )
      )
        return reply(response, 403, { error: "Local host required" });
      const path = request.url;
      if (
        request.method === "GET" &&
        (path === "/" || path === "/console.js" || path === "/console.css")
      ) {
        const file =
          path === "/"
            ? "deployment-console.html"
            : path === "/console.js"
              ? "deployment-console-browser.js"
              : "deployment-console.css";
        response.writeHead(200, {
          "Content-Type":
            path === "/"
              ? "text/html"
              : path.endsWith(".js")
                ? "text/javascript"
                : "text/css",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        });
        response.end(readFileSync(new URL(file, import.meta.url)));
        return;
      }
      const supplied = String(request.headers["x-deployment-capability"] ?? "");
      if (
        request.method !== "POST" ||
        request.headers.origin !== origin ||
        !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(capability))
      )
        return reply(response, 403, {
          error: "Local request authorization required",
        });
      if (busy)
        return reply(response, 409, {
          error: "Another deployment operation is in progress",
        });
      busy = true;
      try {
        const data = await body(request);
        if (path === "/api/status") return reply(response, 200, await status());
        if (path === "/api/prepare")
          return reply(response, 200, await prepare(false));
        if (path === "/api/recover")
          return reply(response, 200, await prepare(true));
        if (path === "/api/submit") {
          if (
            !prepared ||
            data.id !== prepared.id ||
            typeof data.transaction !== "string"
          )
            throw new Error("Approval no longer matches the prepared step");
          await refreshPending();
          if (pending())
            throw new Error("An earlier approval is still pending");
          const transaction = Transaction.from(
            Buffer.from(data.transaction, "base64"),
          );
          assertDeploymentWalletSignature(
            transaction,
            prepared.messageHash,
            new PublicKey(manifest.wallet),
          );
          if ((await rpc.getGenesisHash()) !== manifest.genesis)
            throw new Error("RPC network changed");
          if (
            (await rpc.getBlockHeight("finalized")) >
            prepared.lastValidBlockHeight
          )
            throw new Error(
              "Approval expired before submission; prepare the step again",
            );
          const bytes = transaction.serialize();
          if (bytes.length > 1232 || !transaction.signature)
            throw new Error("Invalid signed transaction");
          const item: Entry = {
            kind: prepared.kind,
            signature: signatureText(transaction.signature),
            signedTransaction: bytes.toString("base64"),
            lastValidBlockHeight: prepared.lastValidBlockHeight,
            reservedLamports: String(prepared.reserve),
            state: "pending",
          };
          journal.entries.push(item);
          persist(); // fsync BEFORE broadcast, including its signature and exact signed bytes.
          prepared = null;
          try {
            const signature = await rpc.sendRawTransaction(bytes, {
              skipPreflight: false,
              maxRetries: 0,
            });
            if (signature !== item.signature)
              throw new Error("RPC returned a different signature");
            return reply(response, 200, {
              submitted: true,
              signature: item.signature,
            });
          } catch {
            return reply(response, 202, {
              pending: true,
              message:
                "Saved signed transaction. Outcome is unknown; check status or rebroadcast the same transaction.",
            });
          }
        }
        if (path === "/api/rebroadcast") {
          await refreshPending();
          const item = pending();
          if (!item) return reply(response, 200, await status());
          if ((await rpc.getGenesisHash()) !== manifest.genesis)
            throw new Error("RPC network changed");
          await rpc.sendRawTransaction(
            Buffer.from(item.signedTransaction, "base64"),
            { skipPreflight: false, maxRetries: 0 },
          );
          return reply(response, 200, {
            pending: true,
            message:
              "Rebroadcast the same signed bytes. Check finality before continuing.",
          });
        }
        reply(response, 404, { error: "Unknown operation" });
      } catch (error) {
        reply(response, 400, {
          error:
            error instanceof Error
              ? error.message
              : "Deployment operation failed",
        });
      } finally {
        busy = false;
      }
    });
    openedServer = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Local server did not start");
    origin = `http://127.0.0.1:${address.port}`;
    const accessPath = join(stateDirectory, "console-access.json");
    savePrivateJson(accessPath, { url: `${origin}/#${capability}` });
    return {
      origin,
      accessPath,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            try {
              releaseLock();
              resolve();
            } catch (failure) {
              reject(failure);
            }
          }),
        ),
    };
  } catch (error) {
    if (openedServer?.listening)
      await new Promise<void>((resolve) =>
        openedServer!.close(() => resolve()),
      );
    releaseLock();
    throw error;
  }
}
