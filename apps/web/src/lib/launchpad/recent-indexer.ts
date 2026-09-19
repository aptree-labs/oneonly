import { historyConnection, readHistoryReceipt } from "./history-rpc";
import {
  getDatabase,
  launchTokens,
  poolSnapshots,
  tokenTrades,
  apiLimits,
  and,
  eq,
  inArray,
  sql,
} from "@oneonly/db";
import {
  NETWORK,
  connection,
  PublicKey,
  readEventReceipt,
  assertNetwork,
} from "@oneonly/protocol";
import { indexTradeReceipt } from "./indexer";
import { indexGraduatedReceipt } from "./graduated-indexer";
import { claimIndexerLease } from "./indexer-lease";

/** New finalized trades get their own bounded sweep; this never advances history coverage. */
export async function refreshRecentTrades() {
  if (!(await claimIndexerLease("recent", 45)))
    return { skipped: true, checked: 0 };
  await assertNetwork();
  const db = await getDatabase(),
    rpc = historyConnection(),
    deadline = Date.now() + 20_000;
  // Leases also provide a stable fair rotation when the token count exceeds one batch.
  const records = await db
    .select({ token: launchTokens, dammPool: poolSnapshots.dammPool })
    .from(launchTokens)
    .leftJoin(poolSnapshots, eq(poolSnapshots.tokenId, launchTokens.id))
    .leftJoin(
      apiLimits,
      sql`${apiLimits.key} = ${`indexer:${NETWORK}:recent-pool:`} || ${launchTokens.id}::text`,
    )
    .where(
      and(
        eq(launchTokens.network, NETWORK),
        inArray(launchTokens.status, ["active", "released"]),
      ),
    )
    .orderBy(sql`${apiLimits.expiresAt} asc nulls first`, launchTokens.id)
    .limit(24);
  records.sort((a, b) => Number(!!b.dammPool) - Number(!!a.dammPool));
  let next = 0,
    checked = 0,
    failed = 0;
  async function worker() {
    while (next < records.length && Date.now() < deadline) {
      const { token, dammPool } = records[next++];
      if (!(await claimIndexerLease(`recent-pool:${token.id}`, 40))) continue;
      try {
        const pool = dammPool ?? token.pool,
          venue = dammPool ? "damm-v2" : "dbc";
        const rows = await rpc.getSignaturesForAddress(
          new PublicKey(pool),
          { limit: 25 },
          "finalized",
        );
        const signatures = rows
          .filter((row) => !row.err)
          .map((row) => row.signature);
        const known = signatures.length
          ? await db
              .select({ signature: tokenTrades.signature })
              .from(tokenTrades)
              .where(
                and(
                  eq(tokenTrades.tokenId, token.id),
                  eq(tokenTrades.venue, venue),
                  inArray(tokenTrades.signature, signatures),
                  sql`(${tokenTrades.volumeUsd} is not null or ${tokenTrades.blockTime} > now() - interval '1 minute')`,
                ),
              )
          : [];
        const seen = new Set(known.map((row) => row.signature));
        const poolDeadline = Math.min(deadline, Date.now() + 8_000);
        for (const signature of signatures) {
          if (Date.now() >= poolDeadline) break;
          if (seen.has(signature)) continue;
          const receipt = await readHistoryReceipt(rpc, signature);
          if (!receipt) continue;
          if (dammPool)
            await indexGraduatedReceipt(token, dammPool, signature, receipt);
          else await indexTradeReceipt(token, signature, receipt);
        }
        checked++;
      } catch (error) {
        failed++;
        console.warn("recent-indexer-pool", {
          token: token.id,
          venue: dammPool ? "damm-v2" : "dbc",
          reason: (error instanceof Error ? error.message : "Unavailable")
            .replace(/https?:\/\/\S+/g, "[RPC]")
            .slice(0, 240),
        });
      }
    }
  }
  await Promise.all([worker(), worker()]);
  console.info("recent-indexer", { checked, failed });
  return { skipped: false, checked, failed };
}
