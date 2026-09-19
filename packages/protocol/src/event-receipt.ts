import {
  MessageAccountKeys,
  PublicKey,
  type Connection,
  type VersionedMessage,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { rpcFetch } from "./rpc-fetch";

/** Read-only event data. Deliberately cannot serialize, sign, or submit a transaction. */
export type EventReceipt = {
  blockTime?: number | null;
  meta: VersionedTransactionResponse["meta"];
  transaction: { message: Pick<VersionedMessage, "getAccountKeys"> };
};

export function jsonEventReceipt(
  raw: any,
  signature: string,
): EventReceipt {
  if (
    !["legacy", 0, 1].includes(raw?.version) ||
    raw.transaction?.signatures?.[0] !== signature ||
    !Array.isArray(raw.transaction?.message?.accountKeys) ||
    (raw.blockTime != null && !Number.isFinite(raw.blockTime))
  )
    throw new Error("Invalid transaction receipt");
  const keys = raw.transaction.message.accountKeys.map(
    (key: string) => new PublicKey(key),
  );
  const loaded = raw.meta?.loadedAddresses;
  const loadedAddresses = loaded
    ? {
        writable: loaded.writable.map((key: string) => new PublicKey(key)),
        readonly: loaded.readonly.map((key: string) => new PublicKey(key)),
      }
    : undefined;
  const accounts = new MessageAccountKeys(keys, loadedAddresses);
  return {
    blockTime: raw.blockTime,
    meta: raw.meta ? { ...raw.meta, loadedAddresses } : null,
    transaction: { message: { getAccountKeys: () => accounts } },
  };
}

export function versionOneEventReceipt(raw: any, signature: string): EventReceipt {
  if (raw?.version !== 1) throw new Error("Invalid version-1 transaction receipt");
  return jsonEventReceipt(raw, signature);
}

/** web3.js 1.98 rejects v1. Use documented JSON for history only, keeping signing unchanged. */
export async function readEventReceipt(
  rpc: Pick<Connection, "getTransaction" | "rpcEndpoint">,
  signature: string,
  commitment: "confirmed" | "finalized" = "finalized",
): Promise<EventReceipt | null> {
  try {
    return await rpc.getTransaction(signature, {
      commitment,
      maxSupportedTransactionVersion: 0,
    });
  } catch (error) {
    if (!/Transaction version \(1\) is not supported/.test(String(error)))
      throw error;
  }
  const response = await rpcFetch(rpc.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        { encoding: "json", commitment, maxSupportedTransactionVersion: 1 },
      ],
    }),
  });
  if (!response.ok) throw new Error("Transaction history RPC unavailable");
  const data = await response.json();
  if (data.error) throw new Error("Version-1 transaction history unavailable");
  return data.result === null
    ? null
    : versionOneEventReceipt(data.result, signature);
}
