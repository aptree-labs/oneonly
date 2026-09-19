import { afterEach, expect, it, vi } from "vitest";
import { readEventReceipt, versionOneEventReceipt } from "./event-receipt";
import { canonicalSwapEvents, decodeTransactionEvents } from "./index";
import fixture from "./fixtures/mainnet-v1-swap.json";
afterEach(() => vi.unstubAllGlobals());
it("decodes a real finalized HOMER v1 swap without constructing a signable transaction", () => {
  const receipt = versionOneEventReceipt(fixture.receipt, fixture.signature);
  const events = canonicalSwapEvents(decodeTransactionEvents(receipt));
  const swaps = events.filter(
    (event) => event.name === "evtSwap" || event.name === "evtSwap2",
  );
  expect(swaps).toHaveLength(1);
  expect(swaps[0].data.pool.toString()).toBe(
    "6i2HFFgZ3GvMBLqiqTVvbsZe9o9ZTYmGz3w54Z9wxEKN",
  );
  expect(receipt.transaction.message.getAccountKeys().get(0)?.toBase58()).toBe(
    fixture.receipt.transaction.message.accountKeys[0],
  );
  expect("serialize" in receipt.transaction.message).toBe(false);
  expect(() =>
    versionOneEventReceipt(fixture.receipt, "wrong-signature"),
  ).toThrow("Invalid");
  expect(() =>
    versionOneEventReceipt(
      { ...fixture.receipt, version: 2 },
      fixture.signature,
    ),
  ).toThrow("Invalid");
});
it("retries version-1 history with maxSupportedTransactionVersion 1 only for the version error", async () => {
  const getTransaction = vi
    .fn()
    .mockRejectedValue(
      new Error(
        "Transaction version (1) is not supported by the requesting client",
      ),
    );
  const fetcher = vi.fn(async () => Response.json({ result: fixture.receipt }));
  vi.stubGlobal("fetch", fetcher);
  const rpc = {
    rpcEndpoint: "https://example.invalid",
    getTransaction,
  } as never;
  expect(await readEventReceipt(rpc, fixture.signature)).not.toBeNull();
  expect(
    JSON.parse(
      String(
        (fetcher.mock.calls[0] as unknown[])[1] &&
          ((fetcher.mock.calls[0] as unknown[])[1] as RequestInit).body,
      ),
    ).params[1],
  ).toMatchObject({
    maxSupportedTransactionVersion: 1,
    commitment: "finalized",
  });
  getTransaction.mockRejectedValueOnce(new Error("RPC offline"));
  await expect(readEventReceipt(rpc, fixture.signature)).rejects.toThrow(
    "RPC offline",
  );
  expect(fetcher).toHaveBeenCalledOnce();
});
