import { unstable_cache } from "next/cache";
import { getDatabase, officeTotals } from "@oneonly/db";
import { client, NETWORK } from "@oneonly/protocol";
import { prices } from "./price";
import { feeUsdTotals } from "./office-values";
import { formatUnits } from "@oneonly/core";

export const readOffice = unstable_cache(
  async () => officeTotals(await getDatabase(), NETWORK),
  ["office-totals-v1", NETWORK],
  { revalidate: 60 },
);

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
    const sdk = client();
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
    let checked = 0;
    const deadline = Date.now() + 25_000;
    // Bound concurrency and runtime; an unavailable pool never becomes a zero balance.
    for (
      let offset = 0;
      offset < totals.pools.length && Date.now() < deadline;
      offset += 4
    ) {
      await Promise.all(
        totals.pools.slice(offset, offset + 4).map(async (pool) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const fees = await Promise.race([
              sdk.state.getPoolFeeBreakdown(pool.pool),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("Fee read timed out")),
                  Math.max(1, deadline - Date.now()),
                );
              }),
            ]);
            // This dashboard supports quote-collected fees. Never silently discard base fees.
            if (
              !fees.partner.totalBaseFee.isZero() ||
              !fees.creator.totalBaseFee.isZero()
            )
              return;
            const key = pool.quoteMint ?? pool.quote;
            const item = assets.get(key) ?? {
              symbol: pool.quote,
              mint: pool.quoteMint,
              decimals: pool.quoteDecimals ?? (pool.quote === "SOL" ? 9 : 6),
              revenue: 0n,
              creatorPayouts: 0n,
            };
            item.revenue += BigInt(fees.partner.totalQuoteFee.toString());
            // SDK reconstructs claimed fees from lifetime share minus outstanding fees.
            // Per-swap integer rounding can leave a negative sub-unit residue.
            const paid = BigInt(fees.creator.claimedQuoteFee.toString());
            item.creatorPayouts += paid > 0n ? paid : 0n;
            assets.set(key, item);
            checked++;
          } catch {
            /* Report the missing pool in coverage, not as zero revenue. */
          } finally {
            clearTimeout(timer);
          }
        }),
      );
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
      checked,
      graduated: totals.graduations,
      assets: nativeAssets,
    };
  },
  ["office-fees-v2", NETWORK],
  { revalidate: 60 },
);
