import { Connection } from "@solana/web3.js";
import { publicRpc } from "@oneonly/core";
import { NETWORK, jsonEventReceipt, type EventReceipt } from "@oneonly/protocol";

let nextRead = 0, primaryUnavailableUntil = 0;
/** Background reads only: paced separately, with a circuit breaker for provider throttling. */
export const historyFetch: typeof fetch = async (url, init) => {
  const request = JSON.parse(String(init?.body));
  if (!String(request.method).startsWith("get"))
    throw new Error("History RPC is read-only");
  const wait = Math.max(0, nextRead - Date.now());
  nextRead = Date.now() + wait + 350;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const fallback = publicRpc(NETWORK);
  const read = (endpoint: string) => fetch(endpoint, {
    ...init,
    signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(5000),
    ]),
  });
  if (primaryUnavailableUntil > Date.now()) return read(fallback);
  try {
    const result = await read(String(url));
    if (![429, 502, 503, 504].includes(result.status) || String(url) === fallback)
      return result;
    await result.body?.cancel();
  } catch (error) {
    if (init?.signal?.aborted || String(url) === fallback) throw error;
  }
  primaryUnavailableUntil = Date.now() + 30_000;
  console.warn("History RPC throttled or unavailable; using read-only fallback for 30 seconds");
  return read(fallback);
};
let rpc: Connection | undefined;
export function historyConnection() {
  return rpc ??= new Connection(
    process.env.SOLANA_INDEXER_RPC_URL || process.env.SOLANA_RPC_URL || publicRpc(NETWORK),
    { commitment: "finalized", disableRetryOnRateLimit: true, fetch: historyFetch },
  );
}
/** Read JSON directly so each version-1 receipt uses one request, not an expected failing v0 request first. */
export async function readHistoryReceipt(
  rpc: Pick<Connection, "rpcEndpoint">,
  signature: string,
): Promise<EventReceipt | null> {
  const response = await historyFetch(rpc.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, {
      encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 1,
    }] }),
  });
  if (!response.ok) throw new Error(`History RPC returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`History receipt unavailable (${data.error.code})`);
  return data.result === null ? null : jsonEventReceipt(data.result, signature);
}
