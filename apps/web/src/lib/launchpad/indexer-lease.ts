import { apiLimits, getDatabase, sql } from "@oneonly/db";
import { NETWORK } from "@oneonly/protocol";

/** Atomic database lease: Redis eviction/outages cannot start one RPC scan per visitor. */
export async function claimIndexerLease(name: string, seconds: number) {
  const db = await getDatabase();
  const [lease] = await db
    .insert(apiLimits)
    .values({
      key: `indexer:${NETWORK}:${name}`,
      count: 1,
      expiresAt: sql`now() + ${seconds} * interval '1 second'`,
    })
    .onConflictDoUpdate({
      target: apiLimits.key,
      set: {
        count: 1,
        expiresAt: sql`now() + ${seconds} * interval '1 second'`,
      },
      setWhere: sql`${apiLimits.expiresAt} <= now()`,
    })
    .returning();
  return !!lease;
}
