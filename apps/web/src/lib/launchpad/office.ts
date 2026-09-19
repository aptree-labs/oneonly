import { unstable_cache } from "next/cache";
import { getDatabase, officeTotals } from "@oneonly/db";
import { NETWORK } from "@oneonly/protocol";
import { prices } from "./price";
import { feeUsdTotals } from "./office-values";
import { formatUnits } from "@oneonly/core";
import { readCurveFeeSnapshot } from "./office-fee-snapshot";

// The public API already coalesces and caches this read. Avoid a second stale cache.
export const readOffice = async () =>
  officeTotals(await getDatabase(), NETWORK);

export type OfficeFees = {
  asOf: string;
  pools: number;
  checked: number;
  graduated: number;
  usd?: {
    revenue: number | null;
    creatorPayouts: number | null;
    complete: boolean;
  };
  assets: {
    symbol: string;
    mint: string | null;
    revenue: string;
    creatorPayouts: string;
  }[];
};

/** Keep native totals, with a separately labelled current USD valuation. */
export const readOfficeFees = unstable_cache(
  async (): Promise<OfficeFees> => {
    const totals = await readOffice();
    const feeRows = await readCurveFeeSnapshot(totals.pools);
    const byPool = new Map(feeRows.map((row) => [row.id, row]));
    const assets = new Map<
      string,
      {
        symbol: string;
        mint: string | null;
        decimals: number;
        revenue: bigint;
        creatorPayouts: bigint;
      }
    >();
    for (const pool of totals.pools) {
      const fees = byPool.get(pool.id)!;
      const key = pool.quoteMint ?? pool.quote;
      const item = assets.get(key) ?? {
        symbol: pool.quote,
        mint: pool.quoteMint,
        decimals: pool.quoteDecimals ?? (pool.quote === "SOL" ? 9 : 6),
        revenue: 0n,
        creatorPayouts: 0n,
      };
      item.revenue += fees.revenue;
      item.creatorPayouts += fees.creatorPayouts;
      assets.set(key, item);
    }
    const nativeAssets = [...assets.values()].map((item) => ({
      symbol: item.symbol,
      mint: item.mint,
      revenue: formatUnits(item.revenue.toString(), item.decimals),
      creatorPayouts: formatUnits(
        item.creatorPayouts.toString(),
        item.decimals,
      ),
    }));
    const references = await prices().catch(() => null);
    return {
      usd: feeUsdTotals(nativeAssets, references),
      asOf: new Date().toISOString(),
      pools: totals.launches,
      checked: feeRows.length,
      graduated: totals.graduations,
      assets: nativeAssets,
    };
  },
  ["office-fees-v3", NETWORK],
  { revalidate: 60 },
);
