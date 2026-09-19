import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../../../../packages/protocol/src/fixtures/mainnet-damm-v1-swap.json";
import { publicRpc } from "@oneonly/core";
import { NETWORK } from "@oneonly/protocol";
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("reads a v1 receipt in one request and preserves its decoded account keys", async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ result: fixture.receipt }));
  vi.stubGlobal("fetch", fetcher);
  const { readHistoryReceipt } = await import("./history-rpc");
  const receipt = await readHistoryReceipt({ rpcEndpoint: "https://example.invalid" }, fixture.signature);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(receipt?.transaction.message.getAccountKeys().get(0)?.toString()).toBe(fixture.receipt.transaction.message.accountKeys[0]);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).params[1].maxSupportedTransactionVersion).toBe(1);
});
it("uses a read-only fallback after throttling and avoids retrying the throttled provider during cooldown", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("throttled", { status: 429 }))
    .mockImplementation(async () => Response.json({ result: [] }));
  vi.stubGlobal("fetch", fetcher);
  const { historyFetch } = await import("./history-rpc");
  const request = { method: "POST", body: JSON.stringify({ method: "getSignaturesForAddress", params: [] }) };
  await historyFetch("https://example.invalid", request);
  await historyFetch("https://example.invalid", request);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://example.invalid", publicRpc(NETWORK), publicRpc(NETWORK)]);
  await expect(historyFetch("https://example.invalid", { body: JSON.stringify({ method: "sendTransaction" }) })).rejects.toThrow("read-only");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
