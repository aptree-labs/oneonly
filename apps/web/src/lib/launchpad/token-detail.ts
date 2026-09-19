import { cache } from "react";
import { getDatabase, poolSnapshots, tokenTrades, eq, desc } from "@oneonly/db";
import { quoteAssets, quoteMultiplier } from "@oneonly/protocol";
import { tokenById } from "./transactions";
import { refreshSnapshot } from "./indexer";
import { displayReferences } from "./discovery";
import { marketValue } from "./market-value";
import { scaledFields, snapshotQuoteFields } from "./display-units";

export const tokenRecord = cache(tokenById);
const refreshing = new Map<
  string,
  Promise<Awaited<ReturnType<typeof refreshSnapshot>>>
>();
function refresh(token: Awaited<ReturnType<typeof tokenById>>) {
  const active = refreshing.get(token.id);
  if (active) return active;
  const work = refreshSnapshot(token).finally(() =>
    refreshing.delete(token.id),
  );
  refreshing.set(token.id, work);
  return work;
}
export async function tokenDetail(id: string, live = false) {
  const db = await getDatabase();
  const token = await tokenRecord(id);
  const [saved, trades, multiplier, references, fresh] = await Promise.all([
    db
      .select()
      .from(poolSnapshots)
      .where(eq(poolSnapshots.tokenId, id))
      .limit(1),
    db
      .select()
      .from(tokenTrades)
      .where(eq(tokenTrades.tokenId, id))
      .orderBy(desc(tokenTrades.blockTime))
      .limit(100),
    quoteMultiplier(token.quote),
    displayReferences(),
    live ? refresh(token).catch(() => null) : null,
  ]);
  const current = fresh ?? saved[0] ?? null;
  const value = {
    ...token,
    marketCapUsd: marketValue(token, current, references, quoteAssets()),
    priceUsd: marketValue(
      token,
      current ? { ...current, marketCapQuote: current.priceQuote } : null,
      references,
      quoteAssets(),
    ),
    reserveUsd: marketValue(
      token,
      current ? { ...current, marketCapQuote: current.quoteReserve } : null,
      references,
      quoteAssets(),
    ),
    usdReferenceTime: references?.timestamp ?? null,
    snapshot: current
      ? scaledFields(current, snapshotQuoteFields, multiplier)
      : null,
    quoteMultiplier: multiplier,
    stale: live
      ? !fresh
      : !current || Date.now() - current.updatedAt.getTime() > 30_000,
    trades: trades.map((item) =>
      scaledFields(item, ["quoteAmount", "priceQuote"], multiplier),
    ),
  };
  return JSON.parse(
    JSON.stringify(value),
  ) as import("@/components/launchpad/token").Detail;
}
