import { it, expect, vi, afterEach } from "vitest";
import { rpcFetch } from "./rpc-fetch";
afterEach(() => vi.unstubAllGlobals());
it("coalesces identical in-flight reads and preserves each request ID", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const request = (id: number) =>
    rpcFetch("https://rpc.example", {
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "getBalance",
        params: ["wallet"],
      }),
    });
  const first = request(1),
    second = request(2);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(Response.json({ jsonrpc: "2.0", id: 1, result: { value: 99 } }));
  expect(await (await first).json()).toMatchObject({
    id: 1,
    result: { value: 99 },
  });
  expect(await (await second).json()).toMatchObject({
    id: 2,
    result: { value: 99 },
  });
});
it("never deduplicates transaction broadcasts", async () => {
  const fetch = vi.fn(async () => Response.json({ result: "signature" }));
  vi.stubGlobal("fetch", fetch);
  const init = {
    body: JSON.stringify({
      id: 1,
      method: "sendTransaction",
      params: ["wire"],
    }),
  };
  await Promise.all([
    rpcFetch("https://rpc.example", init),
    rpcFetch("https://rpc.example", init),
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("retries a transient read once without caching its result", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("busy", { status: 503 }))
    .mockResolvedValue(Response.json({ result: 10 }));
  vi.stubGlobal("fetch", fetch);
  const init = { body: JSON.stringify({ id: 3, method: "getBlockHeight" }) };
  expect(await (await rpcFetch("https://rpc.example", init)).json()).toEqual({
    id: 3,
    result: 10,
  });
  await rpcFetch("https://rpc.example", init);
  expect(fetch).toHaveBeenCalledTimes(3);
});
