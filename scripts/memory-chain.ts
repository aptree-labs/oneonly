import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import {
  LiteSVM,
  FailedTransactionMetadata,
} from "../packages/protocol/node_modules/litesvm";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  Keypair,
} from "../packages/protocol/node_modules/@solana/web3.js";
import bs58 from "../packages/protocol/node_modules/bs58";
const requireProtocol = createRequire(
  resolve("packages/protocol/package.json"),
);
const kit = createRequire(requireProtocol.resolve("litesvm"))("@solana/kit");

/** In-process RPC facade. No HTTP server, ledger, or possible transaction broadcast. */
export async function memoryChain() {
  const svm = new LiteSVM();
  const clock = svm.getClock();
  clock.unixTimestamp = BigInt(Math.floor(Date.now() / 1000));
  try {
    const captured = JSON.parse(
      await readFile(".data/mainnet-fork/jupiter-programs.json", "utf8"),
    );
    clock.slot = BigInt(captured.slot);
    if (captured.unixTimestamp)
      clock.unixTimestamp = BigInt(captured.unixTimestamp);
  } catch {}
  svm.setClock(clock);
  for (const file of await readdir(".data/mainnet-fork/programs")) {
    if (!file.endsWith(".so")) continue;
    svm.addProgram(
      file.slice(0, -3) as any,
      await readFile(`.data/mainnet-fork/programs/${file}`),
    );
  }
  for (const file of await readdir(".data/mainnet-fork/accounts")) {
    const { pubkey, account } = JSON.parse(
      await readFile(`.data/mainnet-fork/accounts/${file}`, "utf8"),
    );
    svm.setAccount({
      address: pubkey,
      programAddress: account.owner,
      lamports: BigInt(account.lamports),
      data: Buffer.from(account.data[0], "base64"),
      executable: account.executable,
      space: BigInt(Buffer.from(account.data[0], "base64").length),
    });
  }
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        await readFile(".data/mainnet-fork/local-only-wallet.json", "utf8"),
      ),
    ),
  );
  svm.airdrop(wallet.publicKey.toBase58() as any, 1_000_000_000_000n as any);
  const rpc = new Connection("http://127.0.0.1:1", "confirmed");
  const readAccount = (key: string) => {
    const value = svm.getAccount(key as any);
    return value.exists
      ? {
          data: [Buffer.from(value.data).toString("base64"), "base64"],
          owner: value.programAddress,
          lamports: Number(value.lamports),
          executable: value.executable,
          rentEpoch: 0,
        }
      : null;
  };
  const context = () => ({ slot: Number(svm.getClock().slot) });
  (rpc as any)._rpcRequest = async (method: string, args: any[]) => {
    let result: any;
    if (method === "getAccountInfo")
      result = { context: context(), value: readAccount(args[0]) };
    else if (method === "getMultipleAccounts")
      result = { context: context(), value: args[0].map(readAccount) };
    else if (method === "getGenesisHash") result = "local-memory-only";
    else if (method === "getSlot") result = Number(svm.getClock().slot);
    else if (method === "getBlockTime")
      result = Number(svm.getClock().unixTimestamp);
    else if (method === "getMinimumBalanceForRentExemption")
      result = Number(svm.minimumBalanceForRentExemption(BigInt(args[0])));
    else if (method === "getLatestBlockhash")
      result = {
        context: context(),
        value: {
          blockhash: svm.latestBlockhash(),
          lastValidBlockHeight: 999999,
        },
      };
    else if (method === "getEpochInfo")
      result = {
        epoch: Number(svm.getClock().epoch),
        slotIndex: 0,
        slotsInEpoch: 432000,
        absoluteSlot: Number(svm.getClock().slot),
        blockHeight: 1,
        transactionCount: 0,
      };
    else if (method === "getTokenAccountsByOwner") {
      const owner = new PublicKey(args[0]).toBuffer();
      result = {
        context: context(),
        value: svm
          .getProgramAccounts(args[1].programId)
          .filter((account) => {
            const data = Buffer.from(account.data);
            return data.length >= 165 && data.subarray(32, 64).equals(owner);
          })
          .map((account) => ({
            pubkey: account.address,
            account: readAccount(account.address),
          })),
      };
    } else if (method === "getProgramAccounts") {
      result = svm
        .getProgramAccounts(args[0])
        .filter((account) =>
          (args[1]?.filters ?? []).every((filter: any) => {
            if (filter.dataSize !== undefined)
              return account.data.length === filter.dataSize;
            const bytes = Buffer.from(bs58.decode(filter.memcmp.bytes));
            return Buffer.from(account.data)
              .subarray(
                filter.memcmp.offset,
                filter.memcmp.offset + bytes.length,
              )
              .equals(bytes);
          }),
        )
        .map((account) => ({
          pubkey: account.address,
          account: readAccount(account.address),
        }));
      if (args[1]?.withContext) result = { context: context(), value: result };
    } else
      throw new Error(
        `In-memory facade needs ${method}; network fallback is prohibited`,
      );
    return { jsonrpc: "2.0", id: "memory", result };
  };
  (rpc as any)._rpcBatchRequest = async (requests: any[]) =>
    Promise.all(
      requests.map((request) =>
        (rpc as any)._rpcRequest(request.methodName, request.args),
      ),
    );
  async function send(
    tx: Transaction | VersionedTransaction,
    signers: Keypair[] = [],
  ) {
    if (tx instanceof Transaction) {
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = svm.latestBlockhash();
      tx.sign(wallet, ...signers);
    } else {
      tx.message.recentBlockhash = svm.latestBlockhash();
      tx.sign([wallet, ...signers]);
    }
    const result = svm.sendTransaction(
      kit.getTransactionDecoder().decode(tx.serialize()),
    );
    if (result instanceof FailedTransactionMetadata) {
      const error = new Error(String(result.err())) as Error & {
        logs: string[];
      };
      error.logs = result.meta().logs();
      throw error;
    }
    svm.expireBlockhash();
    return bs58.encode(
      tx instanceof Transaction ? tx.signature! : tx.signatures[0],
    );
  }
  return { rpc, wallet, send, svm };
}
