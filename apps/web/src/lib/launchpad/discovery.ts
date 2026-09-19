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
    return value && Date.now() - value.timestamp < 30_000 ? value : null;
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
const cachedListings = unstable_cache(
  async (
    query: DiscoveryQuery,
    network: string,
    quoteMints: Record<string, string>,
  ) => {
    const data = await marketListings(await getDatabase(), {
      ...query,
      network,
      references: await displayReferences(),
      quoteMints,
    });
    return JSON.parse(
      JSON.stringify(data),
    ) as import("../market-results").MarketResults;
  },
  ["discovery-listings-v2"],
  { revalidate: 5, tags: [tag] },
);
export async function discovery(query: DiscoveryQuery) {
  return cachedListings(
    {
      ...query,
      age: query.age ?? "All",
      search: query.search.trim().replace(/^\$/, "").toLowerCase(),
    },
    NETWORK,
    Object.fromEntries(quoteAssets().map((a) => [a.symbol, a.mint])),
  );
}
export function invalidateDiscovery() {
  revalidateTag(tag, { expire: 0 });
}
