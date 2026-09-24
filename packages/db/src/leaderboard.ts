import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { launchTokens, tokenTrades, walletProfiles } from "./schema";
import type { Database } from "./index";

export type LeaderboardPeriod = "24h" | "7d" | "all";
/** Rankings use historical USD values, never today's price multiplied by past trades. */
export async function traderLeaderboard(
  db: Database,
  network: string,
  period: LeaderboardPeriod,
  now = new Date(),
  includeProfiles = false,
) {
  const since =
    period === "all"
      ? null
      : new Date(now.getTime() - (period === "7d" ? 7 : 1) * 86_400_000);
  const volume = sql<number>`sum(${tokenTrades.volumeUsd}::numeric)`.mapWith(
    Number,
  );
  const count = sql<number>`count(*)`.mapWith(Number);
  const rows = await db
    .select({
      wallet: tokenTrades.wallet,
      volumeUsd: volume,
      trades: count,
      buys: sql<number>`count(*) filter (where ${tokenTrades.side} = 'buy')`.mapWith(
        Number,
      ),
      sells:
        sql<number>`count(*) filter (where ${tokenTrades.side} = 'sell')`.mapWith(
          Number,
        ),
      tokens: sql<number>`count(distinct ${tokenTrades.tokenId})`.mapWith(
        Number,
      ),
      totalTraders: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(tokenTrades)
    .innerJoin(launchTokens, eq(tokenTrades.tokenId, launchTokens.id))
    .where(
      and(
        eq(launchTokens.network, network),
        inArray(launchTokens.status, ["active", "released"]),
        inArray(tokenTrades.side, ["buy", "sell"]),
        sql`${tokenTrades.wallet} <> ''`,
        // Unpriced trades do not contribute to any ranked metric.
        sql`${tokenTrades.volumeUsd} > 0 and ${tokenTrades.volumeUsd} < 'Infinity'::real`,
        lt(tokenTrades.blockTime, now),
        since ? gte(tokenTrades.blockTime, since) : undefined,
      ),
    )
    .groupBy(tokenTrades.wallet)
    .orderBy(desc(volume), desc(count), asc(tokenTrades.wallet))
    .limit(100);
  const profiles =
    includeProfiles && rows.length
      ? await db
          .select({
            wallet: walletProfiles.wallet,
            username: walletProfiles.xUsername,
            avatar: walletProfiles.xAvatar,
          })
          .from(walletProfiles)
          .where(
            inArray(
              walletProfiles.wallet,
              rows.map((row) => row.wallet),
            ),
          )
      : [];
  const profileMap = new Map(
    profiles.map((profile) => [
      profile.wallet,
      { username: profile.username, avatar: profile.avatar },
    ]),
  );
  return {
    period,
    asOf: now.toISOString(),
    totalTraders: rows[0]?.totalTraders ?? 0,
    traders: rows.map(({ totalTraders: _total, ...row }, i) => ({
      ...row,
      rank: i + 1,
      profile: profileMap.get(row.wallet) ?? null,
    })),
  };
}
export type TraderLeaderboard = Awaited<ReturnType<typeof traderLeaderboard>>;
