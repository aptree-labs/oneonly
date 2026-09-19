import { unstable_cache, revalidateTag } from "next/cache";
import { after } from "next/server";
import {
  getDatabase,
  marketListings,
  type MarketPair,
  type MarketSort,
} from "@oneonly/db";
import { NETWORK, quoteAssets } from "@oneonly/protocol";
import { prices } from "./price";
import {
  marketFreshUntil,
  marketUsableUntil,
  type MarketResults,
} from "../market-results";

const tag = `discovery:${NETWORK}`;
const referenceCache = unstable_cache(
  async (_network: string, _mints: string) => prices(),
  ["display-prices-v1"],
  { revalidate: 10 },
);
/** Display only: a slow price service must not hold up names, search or navigation. */
export async function displayReferences() {
  const work = referenceCache(
    NETWORK,
    JSON.stringify(quoteAssets().map((a) => [a.symbol, a.mint])),
  ).catch(() => null);
  after(async () => {
    await work;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 250);
      }),
    ]);
    return value &&
      Date.now() >= value.timestamp &&
      Date.now() - value.timestamp < 30_000
      ? value
      : null;
  } finally {
    clearTimeout(timer);
  }
}
export type DiscoveryQuery = {
  sort: MarketSort;
  pair: MarketPair;
  age?: "All" | "24h" | "7d";
  search: string;
  page: number;
};
async function readListings(
  query: DiscoveryQuery,
  network: string,
  quoteMints: Record<string, string>,
): Promise<MarketResults> {
  const [db, references] = await Promise.all([
    getDatabase(),
    displayReferences(),
  ]);
  const data = await marketListings(db, {
    ...query,
    network,
    references,
    quoteMints,
  });
  return JSON.parse(
    JSON.stringify({
      ...data,
      usdReferenceTime: references?.timestamp ?? null,
    }),
  );
}
const cachedListings = unstable_cache(readListings, ["discovery-listings-v3"], {
  revalidate: 5,
  tags: [tag],
});
// Hot server requests avoid another remote Data Cache read. This layer never extends
// the snapshot's original freshness, and is bounded independently of search cardinality.
const snapshots = new Map<string, MarketResults>();
const pending = new Map<string, Promise<MarketResults>>();
let generation = 0;
export async function discovery(query: DiscoveryQuery) {
  const normalized = {
    sort: query.sort,
    pair: query.pair,
    age: query.age ?? "All",
    search: query.search.trim().replace(/^\$/, "").toLowerCase(),
    page: query.page,
  };
  const mints = Object.fromEntries(
    quoteAssets().map((a) => [a.symbol, a.mint]),
  );
  const key = JSON.stringify([normalized, NETWORK, mints]);
  const saved = snapshots.get(key);
  if (saved && marketFreshUntil(saved) > Date.now()) return saved;
  const existing = pending.get(key);
  if (existing) return existing;
  const started = generation;
  const work = (async () => {
    let value = await cachedListings(normalized, NETWORK, mints);
    // Next may return stale data while revalidating, including during an outage.
    // Keep the same 15-second public snapshot limit; never serve it indefinitely.
    if (marketUsableUntil(value) <= Date.now())
      value = await readListings(normalized, NETWORK, mints);
    if (started === generation) {
      snapshots.delete(key);
      snapshots.set(key, value);
      while (snapshots.size > 64)
        snapshots.delete(snapshots.keys().next().value!);
    }
    return value;
  })().finally(() => {
    if (pending.get(key) === work) pending.delete(key);
  });
  pending.set(key, work);
  return work;
}
export function invalidateDiscovery() {
  generation++;
  snapshots.clear();
  pending.clear();
  revalidateTag(tag, { expire: 0 });
}
