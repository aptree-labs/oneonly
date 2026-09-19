import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  launchTokens,
  poolSnapshots,
  tokenTrades,
  graduatedIndexes,
} from "./schema";
import type { Database } from "./index";

/** Lifetime means confirmed launches, including tickers subsequently released. */
export async function officeTotals(
  db: Database,
  network: string,
  now = new Date(),
) {
  const launched = and(
    eq(launchTokens.network, network),
    inArray(launchTokens.status, ["active", "released"]),
  );
  const [pools, volumes] = await Promise.all([
    db
      .select({
        token: launchTokens,
        snapshot: poolSnapshots,
        migratedIndex: graduatedIndexes,
      })
      .from(launchTokens)
      .leftJoin(poolSnapshots, eq(launchTokens.id, poolSnapshots.tokenId))
      .leftJoin(graduatedIndexes, eq(launchTokens.id, graduatedIndexes.tokenId))
      .where(launched),
    db
      .select({
        symbol: launchTokens.quote,
        mint: launchTokens.quoteMint,
        amount: sql<string>`sum(${tokenTrades.quoteAmount}::numeric)`,
        usd: sql<string | null>`sum(${tokenTrades.volumeUsd}::numeric)`,
        trades: sql<number>`count(*)`.mapWith(Number),
        unpriced:
          sql<number>`count(*) filter (where ${tokenTrades.volumeUsd} is null)`.mapWith(
            Number,
          ),
      })
      .from(tokenTrades)
      .innerJoin(launchTokens, eq(tokenTrades.tokenId, launchTokens.id))
      .where(and(launched, lt(tokenTrades.blockTime, now)))
      .groupBy(launchTokens.quote, launchTokens.quoteMint),
  ]);
  const covered = pools.filter(({ token, snapshot: s, migratedIndex: g }) => {
    if (!s?.coverageStart || !s.indexedThrough || !token.activatedAt)
      return false;
    if (s.coverageStart > token.activatedAt) return false;
    if (s.graduated)
      return (
        !!g?.coverageStart &&
        !!g.indexedThrough &&
        s.indexedThrough >= g.coverageStart &&
        g.indexedThrough.getTime() >= now.getTime() - 600_000
      );
    return s.indexedThrough.getTime() >= now.getTime() - 600_000;
  }).length;
  const priced = volumes.some((row) => row.usd !== null);
  const trades = volumes.reduce((sum, row) => sum + row.trades, 0);
  return {
    asOf: now.toISOString(),
    network,
    launches: pools.length,
    graduations: pools.filter(({ snapshot }) => snapshot?.graduated).length,
    uncheckedPools: pools.filter(({ snapshot }) => !snapshot).length,
    coveredPools: covered,
    volumeUsd: priced
      ? volumes.reduce((sum, row) => sum + Number(row.usd ?? 0), 0)
      : trades
        ? null
        : 0,
    trades,
    unpricedTrades: volumes.reduce((sum, row) => sum + row.unpriced, 0),
    volumeComplete:
      covered === pools.length && volumes.every((row) => row.unpriced === 0),
    volumes,
    // Retained internally for fee reads; the public totals endpoint omits these rows.
    pools: pools.map(({ token, snapshot }) => ({
      ...token,
      graduated: snapshot?.graduated ?? false,
    })),
  };
}
