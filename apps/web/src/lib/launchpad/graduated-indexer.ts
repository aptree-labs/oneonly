import { historyConnection } from "./history-rpc";
import { scanHistory, HISTORY_PAGE_SIZE } from "./scan-history";
import {
  getDatabase,
  graduatedIndexes,
  tokenTrades,
  eq,
  and,
  type launchTokens,
} from "@oneonly/db";
import {
  connection,
  readEventReceipt,
  PublicKey,
  decodeTransactionEvents,
  type EventReceipt,
} from "@oneonly/protocol";
import { formatUnits } from "@oneonly/core";
import { historicalUsd } from "./price";

/** Receipt ingestion is independent of historical cursors, so new trades are never held behind backfill. */
export async function indexGraduatedReceipt(
  token: typeof launchTokens.$inferSelect,
  pool: string,
  signature: string,
  tx: EventReceipt,
) {
  if (
    !tx.meta ||
    tx.meta.err ||
    !tx.blockTime ||
    !tx.meta.logMessages ||
    tx.meta.logMessages.some((log) => log.includes("Log truncated"))
  )
    throw new Error("Incomplete graduated transaction history");
  const db = await getDatabase();
  let creation: Date | null = null;
  const events = decodeTransactionEvents(tx, "damm-v2");
  let matched = false;
  for (const [eventIndex, event] of events.entries()) {
    const data = event.data;
    if (data.pool?.toString() !== pool) continue;
    if (event.name === "evtInitializePool") {
      creation = new Date(tx.blockTime! * 1000);
      continue;
    }
    if (event.name !== "evtSwap2") continue;
    matched = true;
    const sell = data.tradeDirection === 0,
      result = data.swapResult;
    const input = BigInt(result.includedFeeInputAmount.toString());
    const output = BigInt(result.outputAmount.toString());
    // Gross quote turnover includes quote-side fees, matching DBC accounting and conservative inactivity checks.
    const base = sell ? input : output,
      quote = sell
        ? output +
          BigInt(result.claimingFee.toString()) +
          BigInt(result.compoundingFee.toString()) +
          BigInt(result.protocolFee.toString()) +
          BigInt(result.referralFee.toString())
        : input;
    if (base <= 0n || quote <= 0n)
      throw new Error("Invalid graduated swap amounts");
    const baseAmount = formatUnits(base, 6),
      quoteAmount = formatUnits(
        quote,
        token.quoteDecimals ?? (token.quote === "SOL" ? 9 : 6),
      );
    const time = new Date(tx.blockTime! * 1000);
    const keys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: tx.meta.loadedAddresses,
    });
    await db
      .insert(tokenTrades)
      .values({
        tokenId: token.id,
        signature,
        eventIndex,
        venue: "damm-v2",
        wallet: keys.get(0)!.toBase58(),
        side: sell ? "sell" : "buy",
        baseAmount,
        quoteAmount,
        priceQuote: (Number(quoteAmount) / Number(baseAmount)).toString(),
        volumeUsd: null,
        blockTime: time,
      })
      .onConflictDoNothing();
    // Native turnover must survive a temporary historical-price outage.
    const reference = await historicalUsd(token.quote, time);
    if (reference !== null)
      await db
        .update(tokenTrades)
        .set({ volumeUsd: Number(quoteAmount) * reference })
        .where(
          and(
            eq(tokenTrades.signature, signature),
            eq(tokenTrades.venue, "damm-v2"),
            eq(tokenTrades.eventIndex, eventIndex),
          ),
        );
  }
  // Unknown swaps cannot establish complete history. Keep tickers claimed until the decoder supports them.
  if (
    !matched &&
    tx.meta.logMessages?.some((log) => /Instruction: Swap/.test(log))
  )
    throw new Error("Unrecognized graduated swap event");
  return { creation, matched };
}

/** A separate cursor proves DAMM coverage back to its initialization, including migration transactions. */
export async function indexGraduatedPool(
  token: typeof launchTokens.$inferSelect,
  pool: string,
  deadline: number,
) {
  const db = await getDatabase(),
    rpc = historyConnection();
  await db
    .insert(graduatedIndexes)
    .values({ tokenId: token.id, pool })
    .onConflictDoNothing();
  const [previous] = await db
    .select()
    .from(graduatedIndexes)
    .where(eq(graduatedIndexes.tokenId, token.id));
  if (previous.pool !== pool) throw new Error("Graduation destination changed");
  const rootTime = await rpc.getBlockTime(await rpc.getSlot("finalized"));
  if (!rootTime)
    return { indexed: false, reason: "Finalized chain time unavailable" };
  const rows = await rpc.getSignaturesForAddress(
    new PublicKey(pool),
    { before: previous.scanBefore ?? undefined, limit: HISTORY_PAGE_SIZE },
    "finalized",
  );
  const boundary = previous.cursor
    ? rows.findIndex((row) => row.signature === previous.cursor)
    : -1;
  const entries = boundary >= 0 ? rows.slice(0, boundary) : rows;
  const scanHead = previous.scanHead ?? rows[0]?.signature ?? previous.cursor;
  const scanStartedAt = previous.scanStartedAt ?? new Date(rootTime * 1000);
  let lastProcessed = previous.scanBefore,
    creation = previous.coverageStart;
  const checkpoint = () =>
    db
      .update(graduatedIndexes)
      .set({
        scanHead,
        scanStartedAt,
        scanBefore: lastProcessed,
        coverageStart: creation,
      })
      .where(eq(graduatedIndexes.tokenId, token.id));
  const scan = await scanHistory({
    rpc,
    entries,
    deadline,
    cursor: lastProcessed,
    visit: async (signature, tx) => {
      const receipt = await indexGraduatedReceipt(token, pool, signature, tx);
      if (receipt.creation) creation = receipt.creation;
      return !!receipt.creation && !previous.cursor;
    },
    checkpoint: async (cursor) => {
      lastProcessed = cursor;
      await checkpoint();
    },
  });
  if (!scan.complete) return { indexed: false, reason: scan.reason };
  const complete = boundary >= 0 || (!previous.cursor && !!creation);
  if (!complete) {
    if (rows.length < HISTORY_PAGE_SIZE)
      return {
        indexed: false,
        reason: "Graduated history boundary unavailable",
      };
    await checkpoint();
    return { indexed: false, reason: "Graduated history continuing next run" };
  }
  await db
    .update(graduatedIndexes)
    .set({
      cursor: scanHead,
      scanBefore: null,
      scanHead: null,
      scanStartedAt: null,
      coverageStart: creation,
      indexedThrough: scanStartedAt,
    })
    .where(eq(graduatedIndexes.tokenId, token.id));
  return { indexed: true };
}
