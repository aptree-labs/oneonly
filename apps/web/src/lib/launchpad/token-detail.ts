import { creatorFeeEnvironmentEnabled } from "../deployment";
import { cache } from "react";
import {
  getDatabase,
  poolSnapshots,
  tokenTrades,
  creatorFeePools,
  creatorFeeAllocations,
  creatorFeeProfiles,
  eq,
  and,
  desc,
} from "@oneonly/db";
import { quoteAssets, quoteMultiplier, NETWORK } from "@oneonly/protocol";
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
  const feePools =
    creatorFeeEnvironmentEnabled(NETWORK) && token.network === NETWORK
      ? await db
          .select({
            tokenId: creatorFeePools.tokenId,
            xId: creatorFeeProfiles.xId,
            username: creatorFeeProfiles.username,
            name: creatorFeeProfiles.name,
            avatar: creatorFeeProfiles.avatar,
            shareBps: creatorFeeAllocations.shareBps,
          })
          .from(creatorFeePools)
          .leftJoin(
            creatorFeeAllocations,
            eq(creatorFeeAllocations.tokenId, creatorFeePools.tokenId),
          )
          .leftJoin(
            creatorFeeProfiles,
            eq(creatorFeeProfiles.xId, creatorFeeAllocations.xId),
          )
          .where(
            and(
              eq(creatorFeePools.tokenId, id),
              eq(creatorFeePools.network, NETWORK),
            ),
          )
          .orderBy(desc(creatorFeeAllocations.shareBps), creatorFeeProfiles.xId)
          .limit(8)
      : [];
  const value = {
    ...token,
    feeSharing: feePools.length > 0,
    feeRecipients: feePools.flatMap((row) =>
      row.xId && row.username && row.shareBps !== null
        ? [
            {
              xId: row.xId,
              username: row.username,
              name: row.name ?? row.username,
              avatar: row.avatar,
              shareBps: row.shareBps,
            },
          ]
        : [],
    ),
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
