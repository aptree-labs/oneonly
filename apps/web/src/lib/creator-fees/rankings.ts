import {
  creatorFeeProfiles,
  creatorFeePools,
  creatorFeeAllocations,
  creatorFeeBalanceSnapshots,
  launchTokens,
  poolSnapshots,
  eq,
  and,
  inArray,
  sql,
  desc,
  type Database,
} from "@oneonly/db";

export type CreatorSort = "fees" | "tokens";
export type CreatorPrices = Record<string, { mint: string; usd: number }>;

/** Rank in the database before pagination; snapshots never authorize payouts. */
export async function creatorRankings(
  db: Database,
  options: {
    network: string;
    query: string;
    offset: number;
    sort: CreatorSort;
    prices: CreatorPrices;
  },
) {
  const term = options.query.trim().replace(/^@/, "").slice(0, 100);
  const references = JSON.stringify(options.prices);
  const quoteUsd = sql`case when ${launchTokens.quoteMint} = (${references}::jsonb -> ${launchTokens.quote} ->> 'mint') then (${references}::jsonb -> ${launchTokens.quote} ->> 'usd')::numeric end`;
  const earned = sql`(coalesce((e->>'totalEntitlementAtomic')::numeric, (e->>'amountAtomic')::numeric + coalesce((e->>'claimedAtomic')::numeric,0)) + coalesce((e->>'pendingAtomic')::numeric,0))`;
  const price = sql`case
    when ${earned}=0 then 0
    when e->>'mint'=${launchTokens.quoteMint} then ${quoteUsd}
    when e->>'mint'=${launchTokens.mint} and (not ${poolSnapshots.graduated} or ${poolSnapshots.marketVenue}='damm-v2')
      then ${poolSnapshots.priceQuote}::numeric * ${quoteUsd}
    end`;
  const tokenFees = sql`case when ${creatorFeeBalanceSnapshots.observedAt} is not null then (
    select case when count(*) > 0 and count(*) filter(where ${price} is null)=0
      then sum(${earned}/power(10::numeric,(e->>'decimals')::int)*(${price})) end
    from jsonb_array_elements(${creatorFeeBalanceSnapshots.balances}) e
  ) end`;
  const feesUsd = sql<
    number | null
  >`case when count(*) filter(where (${tokenFees}) is null)=0 then sum(${tokenFees}) end`.mapWith(
    (v) => (v === null ? null : Number(v)),
  );
  const tokenCount = sql<number>`count(*)::int`;
  const rows = await db
    .select({
      xId: creatorFeeProfiles.xId,
      username: creatorFeeProfiles.username,
      name: creatorFeeProfiles.name,
      avatar: creatorFeeProfiles.avatar,
      tokenCount,
      feesUsd,
      balances: sql<
        | {
            mint: string;
            symbol: string;
            decimals: number;
            amountAtomic: string;
            pendingAtomic: string;
          }[]
        | null
      >`(
        select jsonb_agg(asset) from (
          select e->>'mint' as mint, e->>'symbol' as symbol, (e->>'decimals')::int as decimals,
            sum((e->>'amountAtomic')::numeric)::text as "amountAtomic",
            sum(coalesce((e->>'pendingAtomic')::numeric,0))::text as "pendingAtomic"
          from creator_fee_balance_snapshots s
          join creator_fee_pools p on p.token_id=s.token_id
          join launch_tokens t on t.id=p.token_id
          join creator_fee_allocations a on a.token_id=s.token_id and a.x_id=s.x_id
          cross join lateral jsonb_array_elements(s.balances) e
          where s.x_id=${creatorFeeProfiles.xId} and p.network=${options.network} and t.network=${options.network}
            and t.status in ('active','released') and s.observed_at is not null
          group by e->>'mint', e->>'symbol', e->>'decimals' order by e->>'mint'
        ) asset
      )`,
      observedTokens: sql<number>`count(${creatorFeeBalanceSnapshots.observedAt})::int`,
      freshTokens: sql<number>`count(*) filter(where ${creatorFeeBalanceSnapshots.observedAt} > now() - interval '2 minutes')::int`,
      lastUpdated: sql<
        string | null
      >`min(${creatorFeeBalanceSnapshots.observedAt})`,
    })
    .from(creatorFeeProfiles)
    .innerJoin(
      creatorFeeAllocations,
      eq(creatorFeeAllocations.xId, creatorFeeProfiles.xId),
    )
    .innerJoin(
      creatorFeePools,
      eq(creatorFeePools.tokenId, creatorFeeAllocations.tokenId),
    )
    .innerJoin(launchTokens, eq(launchTokens.id, creatorFeePools.tokenId))
    .leftJoin(
      creatorFeeBalanceSnapshots,
      and(
        eq(creatorFeeBalanceSnapshots.tokenId, creatorFeePools.tokenId),
        eq(creatorFeeBalanceSnapshots.xId, creatorFeeProfiles.xId),
      ),
    )
    .leftJoin(poolSnapshots, eq(poolSnapshots.tokenId, creatorFeePools.tokenId))
    .where(
      and(
        eq(creatorFeePools.network, options.network),
        eq(launchTokens.network, options.network),
        inArray(launchTokens.status, ["active", "released"]),
        sql`position(lower(${term}) in lower(${creatorFeeProfiles.username} || ' ' || ${creatorFeeProfiles.name})) > 0`,
      ),
    )
    .groupBy(creatorFeeProfiles.xId)
    .orderBy(
      ...(options.sort === "fees"
        ? [sql`${feesUsd} desc nulls last`, desc(tokenCount)]
        : [desc(tokenCount), sql`${feesUsd} desc nulls last`]),
      creatorFeeProfiles.xId,
    )
    .limit(25)
    .offset(options.offset);
  return {
    creators: rows.slice(0, 24).map((row, index) => ({
      ...row,
      rank: options.offset + index + 1,
      feesUsd:
        row.feesUsd !== null && Number.isFinite(row.feesUsd)
          ? row.feesUsd
          : null,
    })),
    hasMore: rows.length > 24,
    sort: options.sort,
    asOf: new Date().toISOString(),
  };
}
