import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prices: vi.fn(),
  invalidate: vi.fn(),
  after: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: Function) => fn,
  revalidateTag: mocks.invalidate,
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./price", () => ({ prices: mocks.prices }));
vi.mock("@oneonly/protocol", () => ({
  NETWORK: "mainnet-beta",
  quoteAssets: () => [],
}));
vi.mock("@oneonly/db", () => ({
  getDatabase: vi.fn(),
  marketListings: vi.fn(),
}));
import { displayReferences, invalidateDiscovery } from "./discovery";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("does not block search on a stalled external price feed", async () => {
  vi.useFakeTimers();
  mocks.prices.mockReturnValue(new Promise(() => {}));
  const request = displayReferences();
  await vi.advanceTimersByTimeAsync(250);
  expect(await request).toBeNull();
  expect(mocks.after).toHaveBeenCalledOnce();
});
it("uses fresh display references but never passes old prices off as current", async () => {
  mocks.prices.mockResolvedValue({ SOL: 100, timestamp: Date.now() });
  expect(await displayReferences()).toMatchObject({ SOL: 100 });
  mocks.prices.mockResolvedValue({ SOL: 100, timestamp: Date.now() - 31000 });
  expect(await displayReferences()).toBeNull();
});
it("expires discovery cache entries immediately after a confirmed update", () => {
  invalidateDiscovery();
  expect(mocks.invalidate).toHaveBeenCalledWith("discovery:mainnet-beta", {
    expire: 0,
  });
});
