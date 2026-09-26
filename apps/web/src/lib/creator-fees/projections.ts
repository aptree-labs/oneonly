import {
  getDatabase,
  creatorFeeProfiles,
  creatorFeePools,
  creatorFeeAllocations,
  creatorFeeBalanceSnapshots,
  eq,
  and,
  inArray,
  sql,
  type Database,
} from "@oneonly/db";
import { publicCache } from "../cache/public-cache";
import { readCreatorFeeBalances } from "./balances";
import { creatorFeeRuntime } from "./runtime";
export async function refreshFeeSnapshot(
  tokenId: string,
  xId: string,
  database?: Database,
) {
  const db = database ?? (await getDatabase());
  try {
    const balances = await readCreatorFeeBalances(tokenId, xId),
      observedAt = new Date();
    await db
      .insert(creatorFeeBalanceSnapshots)
      .values({ tokenId, xId, balances, observedAt, attemptedAt: observedAt })
      .onConflictDoUpdate({
        target: [
          creatorFeeBalanceSnapshots.tokenId,
          creatorFeeBalanceSnapshots.xId,
        ],
        set: { balances, observedAt, attemptedAt: observedAt },
      });
    return { balances, observedAt: observedAt.toISOString() };
  } catch (error) {
    await db
      .insert(creatorFeeBalanceSnapshots)
      .values({ tokenId, xId, balances: [], attemptedAt: new Date() })
      .onConflictDoUpdate({
        target: [
          creatorFeeBalanceSnapshots.tokenId,
          creatorFeeBalanceSnapshots.xId,
        ],
        set: { attemptedAt: new Date() },
      });
    throw error;
  }
}
export async function cachedFeeBalances(tokenId: string, xId: string) {
  return publicCache(
    `creator-fees:balances:v1:${process.env.CREATOR_FEE_PROGRAM_ID}:${tokenId}:${xId}`,
    { fresh: 15, stale: 15 },
    async () => {
      const db = await getDatabase();
      const [known] = await db
        .select()
        .from(creatorFeeBalanceSnapshots)
        .where(
          and(
            eq(creatorFeeBalanceSnapshots.tokenId, tokenId),
            eq(creatorFeeBalanceSnapshots.xId, xId),
          ),
        );
      if (known?.observedAt && known.observedAt.getTime() > Date.now() - 15_000)
        return {
          balances: known.balances,
          observedAt: known.observedAt.toISOString(),
        };
      return refreshFeeSnapshot(tokenId, xId, db);
    },
  );
}
/** One shared refresh budget across all recipient-page requests. */
export async function warmFeeSnapshots() {
  return publicCache(
    `creator-fees:snapshot-sweep:v1:${process.env.CREATOR_FEE_PROGRAM_ID}`,
    { fresh: 15, stale: 0 },
    async () => {
      await creatorFeeRuntime();
      const db = await getDatabase();
      const rows = await db
        .select({
          tokenId: creatorFeeAllocations.tokenId,
          xId: creatorFeeAllocations.xId,
        })
        .from(creatorFeeAllocations)
        .innerJoin(
          creatorFeePools,
          eq(creatorFeePools.tokenId, creatorFeeAllocations.tokenId),
        )
        .leftJoin(
          creatorFeeBalanceSnapshots,
          and(
            eq(
              creatorFeeBalanceSnapshots.tokenId,
              creatorFeeAllocations.tokenId,
            ),
            eq(creatorFeeBalanceSnapshots.xId, creatorFeeAllocations.xId),
          ),
        )
        .where(
          and(
            eq(creatorFeePools.network, "devnet"),
            eq(creatorFeePools.program, process.env.CREATOR_FEE_PROGRAM_ID!),
            sql`coalesce(${creatorFeeBalanceSnapshots.attemptedAt},'1970-01-01'::timestamptz) < now() - interval '15 seconds'`,
          ),
        )
        .orderBy(
          sql`coalesce(${creatorFeeBalanceSnapshots.attemptedAt},'1970-01-01'::timestamptz)`,
        )
        .limit(8);
      for (let i = 0; i < rows.length; i += 2)
        await Promise.allSettled(
          rows.slice(i, i + 2).map((r) => cachedFeeBalances(r.tokenId, r.xId)),
        );
      return { refreshed: rows.length };
    },
  );
}
export type RecipientAssetTotal = {
  mint: string;
  symbol: string;
  decimals: number;
  amountAtomic: string;
  pendingAtomic: string;
};
/** Aggregate cached observations in Postgres, not one RPC scan per recipient. */
export async function recipientFeeTotals(xIds: string[], database?: Database) {
  if (!xIds.length) return [];
  const db = database ?? (await getDatabase());
  return db
    .select({
      xId: creatorFeeProfiles.xId,
      observedTokens: sql<number>`(select count(*)::int from creator_fee_balance_snapshots s join creator_fee_pools p on p.token_id=s.token_id where s.x_id=creator_fee_profiles.x_id and p.network='devnet' and s.observed_at is not null)`,
      freshTokens: sql<number>`(select count(*)::int from creator_fee_balance_snapshots s join creator_fee_pools p on p.token_id=s.token_id where s.x_id=creator_fee_profiles.x_id and p.network='devnet' and s.observed_at > now() - interval '2 minutes')`,
      lastUpdated: sql<
        string | null
      >`(select min(s.observed_at) from creator_fee_balance_snapshots s join creator_fee_pools p on p.token_id=s.token_id where s.x_id=creator_fee_profiles.x_id and p.network='devnet')`,
      balances: sql<
        RecipientAssetTotal[] | null
      >`(select jsonb_agg(asset) from (select e->>'mint' as mint,e->>'symbol' as symbol,(e->>'decimals')::int as decimals,sum((e->>'amountAtomic')::numeric)::text as "amountAtomic",sum((e->>'pendingAtomic')::numeric)::text as "pendingAtomic" from creator_fee_balance_snapshots s join creator_fee_pools p on p.token_id=s.token_id cross join lateral jsonb_array_elements(s.balances) e where s.x_id=creator_fee_profiles.x_id and p.network='devnet' and s.observed_at is not null group by e->>'mint',e->>'symbol',e->>'decimals' order by e->>'mint') asset)`,
    })
    .from(creatorFeeProfiles)
    .where(inArray(creatorFeeProfiles.xId, xIds));
}
