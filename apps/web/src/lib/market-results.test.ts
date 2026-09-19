import { afterEach, expect, it, vi } from "vitest";
import {
  clearMarket,
  loadMarket,
  marketKey,
  peekMarket,
  seedMarket,
  marketUsableUntil,
} from "./market-results";
afterEach(() => {
  clearMarket();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("coalesces repeated searches and reuses their fresh response", async () => {
  const fetcher = vi.fn(async () => Response.json({ tokens: [], total: 0 }));
  vi.stubGlobal("fetch", fetcher);
  const key = marketKey(
    new URLSearchParams({ search: " GIDDY ", pair: "SOL" }),
  );
  await Promise.all([loadMarket(key), loadMarket(key)]);
  await loadMarket(key);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(key).toContain("search=GIDDY");
});
it("separates every filter and refreshes after the freshness window", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ tokens: [], total: 0 }));
  vi.stubGlobal("fetch", fetcher);
  const key = marketKey(new URLSearchParams({ search: "GIDDY" }));
  await loadMarket(key);
  await loadMarket(
    marketKey(new URLSearchParams({ search: "GIDDY", pair: "USDC" })),
  );
  vi.advanceTimersByTime(5001);
  await loadMarket(key);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    marketKey(new URLSearchParams({ age: "7d", page: "1", sort: "relevance" })),
  ).not.toBe(key);
});
it("cannot repopulate the cache with a request started before a confirmed transaction", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const key = marketKey(new URLSearchParams());
  const request = loadMarket(key);
  clearMarket();
  finish(Response.json({ tokens: [], total: 1 }));
  await request;
  expect(peekMarket(key)).toBeUndefined();
});
it("does not cache an outage as an empty search result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("failure", { status: 503 })),
  );
  const key = marketKey(new URLSearchParams());
  await expect(loadMarket(key)).rejects.toThrow("couldn’t load");
  expect(peekMarket(key)).toBeUndefined();
});

it("does not restart the freshness clock when receiving a server or CDN snapshot", async () => {
  vi.useFakeTimers();
  const key = marketKey(new URLSearchParams());
  const snapshot = {
    tokens: [],
    total: 1,
    asOf: new Date(Date.now() - 6000).toISOString(),
  };
  seedMarket(key, snapshot);
  expect(peekMarket(key)).toBe(snapshot);
  const fetcher = vi.fn(async () =>
    Response.json({ tokens: [], total: 2, asOf: new Date().toISOString() }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect((await loadMarket(key)).total).toBe(2);
  expect(fetcher).toHaveBeenCalledOnce();
});
it("expires snapshots at the earlier of their data and USD reference deadlines", () => {
  vi.useFakeTimers();
  const key = marketKey(new URLSearchParams());
  seedMarket(key, {
    tokens: [],
    total: 1,
    asOf: new Date().toISOString(),
    usdReferenceTime: Date.now() - 29000,
  });
  expect(peekMarket(key)?.total).toBe(1);
  vi.advanceTimersByTime(1001);
  expect(peekMarket(key)).toBeUndefined();
  const old = {
    tokens: [],
    total: 1,
    asOf: new Date(Date.now() - 16000).toISOString(),
  };
  seedMarket(key, old);
  expect(peekMarket(key)).toBeUndefined();
  expect(marketUsableUntil({ ...old, asOf: "invalid" })).toBeLessThan(
    Date.now(),
  );
});
