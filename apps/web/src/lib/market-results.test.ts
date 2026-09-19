import { afterEach, expect, it, vi } from "vitest";
import {
  clearMarket,
  loadMarket,
  marketKey,
  peekMarket,
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
