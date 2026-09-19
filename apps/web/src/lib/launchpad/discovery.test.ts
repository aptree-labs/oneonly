import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prices: vi.fn(),
  invalidate: vi.fn(),
  after: vi.fn(),
  database: vi.fn(),
  listings: vi.fn(),
  cached: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: Function, keys: string[]) =>
    keys[0].startsWith("discovery-listings")
      ? mocks.cached.mockImplementation((...args: unknown[]) => fn(...args))
      : fn,
  revalidateTag: mocks.invalidate,
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./price", () => ({ prices: mocks.prices }));
vi.mock("@oneonly/protocol", () => ({
  NETWORK: "mainnet-beta",
  quoteAssets: () => [],
}));
vi.mock("@oneonly/db", () => ({
  getDatabase: mocks.database,
  marketListings: mocks.listings,
}));
import { discovery, displayReferences, invalidateDiscovery } from "./discovery";
afterEach(() => {
  vi.useRealTimers();
  invalidateDiscovery();
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
  mocks.prices.mockResolvedValue({ SOL: 100, timestamp: Date.now() + 1000 });
  expect(await displayReferences()).toBeNull();
});
it("expires discovery cache entries immediately after a confirmed update", () => {
  invalidateDiscovery();
  expect(mocks.invalidate).toHaveBeenCalledWith("discovery:mainnet-beta", {
    expire: 0,
  });
});

const query = {
  sort: "volume" as const,
  pair: "All" as const,
  search: "",
  page: 0,
};
it("coalesces a landing burst and skips remote cache reads only while the original snapshot is fresh", async () => {
  vi.useFakeTimers();
  mocks.prices.mockResolvedValue({ SOL: 100, timestamp: Date.now() });
  mocks.listings.mockImplementation(async () => ({
    tokens: [],
    total: 1,
    asOf: new Date().toISOString(),
  }));
  const values = await Promise.all(
    Array.from({ length: 100 }, () => discovery(query)),
  );
  expect(mocks.cached).toHaveBeenCalledOnce();
  expect(values.every((value) => value === values[0])).toBe(true);
  await discovery(query);
  // The SSR page omits age; the API supplies it and builds properties in a different order.
  await discovery({
    page: 0,
    age: "All",
    search: "",
    pair: "All",
    sort: "volume",
  });
  expect(mocks.cached).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5001);
  await discovery(query);
  expect(mocks.cached).toHaveBeenCalledTimes(2);
});
it("bypasses an expired shared snapshot instead of renewing its age", async () => {
  mocks.prices.mockResolvedValue({ SOL: 101, timestamp: Date.now() });
  mocks.cached.mockResolvedValueOnce({
    tokens: [],
    total: 1,
    asOf: new Date(Date.now() - 16000).toISOString(),
  });
  mocks.listings.mockResolvedValue({
    tokens: [],
    total: 2,
    asOf: new Date().toISOString(),
  });
  expect((await discovery(query)).total).toBe(2);
  expect(mocks.listings).toHaveBeenCalledOnce();
});
it("refreshes a recently cached listing when its USD reference has expired", async () => {
  mocks.prices.mockResolvedValue({ SOL: 101, timestamp: Date.now() });
  mocks.cached.mockResolvedValueOnce({
    tokens: [],
    total: 1,
    asOf: new Date().toISOString(),
    usdReferenceTime: Date.now() - 31000,
  });
  mocks.listings.mockResolvedValue({
    tokens: [],
    total: 2,
    asOf: new Date().toISOString(),
  });
  expect((await discovery(query)).total).toBe(2);
});
it("starts the price read while the database connection is still pending", async () => {
  let finish!: (value: unknown) => void;
  mocks.database.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mocks.prices.mockResolvedValue({ SOL: 101, timestamp: Date.now() });
  mocks.listings.mockResolvedValue({
    tokens: [],
    total: 2,
    asOf: new Date().toISOString(),
  });
  const work = discovery(query);
  expect(mocks.prices).toHaveBeenCalledOnce();
  finish({});
  await work;
});
it("invalidates hot snapshots after confirmed changes", async () => {
  mocks.prices.mockResolvedValue({ SOL: 101, timestamp: Date.now() });
  mocks.listings.mockImplementation(async () => ({
    tokens: [],
    total: 1,
    asOf: new Date().toISOString(),
  }));
  await discovery(query);
  invalidateDiscovery();
  await discovery(query);
  expect(mocks.listings).toHaveBeenCalledTimes(2);
});
