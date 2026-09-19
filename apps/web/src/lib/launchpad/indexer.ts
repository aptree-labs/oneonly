import {
  getDatabase,
  launchTokens,
  tickerClaims,
  poolSnapshots,
  tokenTrades,
  graduatedIndexes,
  transactionIntents,
  eq,
  and,
  inArray,
  desc,
  sql,
  gte,
  isNull,
} from "@oneonly/db";
import {
  client,
  connection,
  readEventReceipt,
  type EventReceipt,
  PublicKey,
  NETWORK,
  getPriceFromSqrtPrice,
  decodeTransactionEvents,
  canonicalSwapEvents,
  assertNetwork,
  tradingPool,
} from "@oneonly/protocol";
import {
  canReleaseTicker,
  formatUnits,
  isReservedPlatformTicker,
} from "@oneonly/core";
import { historicalUsd } from "./price";
import { reconcile } from "./transactions";
import { indexGraduatedPool } from "./graduated-indexer";
type Token = typeof launchTokens.$inferSelect;
export async function refreshSnapshot(token: Token) {
  const { virtual, config, state, address, readyToMigrate } = await tradingPool(
    token.pool,
  );
  const pool = virtual.poolState;
  const decimals = token.quoteDecimals ?? (token.quote === "SOL" ? 9 : 6),
    price = getPriceFromSqrtPrice(
      state?.sqrtPrice ?? pool.sqrtPrice,
      6,
      decimals,
    );
  const row = {
    tokenId: token.id,
    priceQuote: price.toString(),
    marketCapQuote: price.mul(1_000_000_000).toString(),
    quoteReserve: state
      ? formatUnits(
          (await connection().getTokenAccountBalance(state.tokenBVault)).value
            .amount,
          decimals,
        )
      : formatUnits(pool.quoteReserve.toString(), decimals),
    progress: Math.min(
      100,
      (Number(pool.quoteReserve.toString()) /
        Number(config.migrationQuoteThreshold.toString())) *
        100,
    ),
    graduated: !!pool.isMigrated,
    marketVenue: state ? "damm-v2" : "dbc",
    dammPool: state ? address.toBase58() : null,
    readyToMigrate,
    creatorQuoteFee: formatUnits(pool.creatorQuoteFee.toString(), decimals),
    updatedAt: new Date(),
  };
  const db = await getDatabase();
  await db
    .insert(poolSnapshots)
    .values(row)
    .onConflictDoUpdate({ target: poolSnapshots.tokenId, set: row });
  return row;
}
/** Idempotent receipt indexing; does not claim complete historical coverage. */
export async function indexTradeReceipt(
  token: Token,
  signature: string,
  transaction: EventReceipt,
) {
  if (
    !transaction.meta ||
    transaction.meta.err ||
    !transaction.blockTime ||
    !transaction.meta.logMessages ||
    transaction.meta.logMessages.some((log) => log.includes("Log truncated"))
  )
    throw new Error("Incomplete transaction history");
  const db = await getDatabase();
  const time = new Date(transaction.blockTime * 1000);
  let matched = 0,
    eventIndex = 0;
  for (const event of canonicalSwapEvents(
    decodeTransactionEvents(transaction),
  )) {
    const index = eventIndex++;
    if (event.name !== "evtSwap" && event.name !== "evtSwap2") continue;
    const data = event.data as {
      pool: PublicKey;
      tradeDirection: number;
      amountIn?: { toString(): string };
      swapResult: {
        actualInputAmount?: { toString(): string };
        includedFeeInputAmount?: { toString(): string };
        outputAmount: { toString(): string };
        protocolFee: { toString(): string };
        tradingFee: { toString(): string };
        referralFee: { toString(): string };
      };
    };
    if (data.pool.toBase58() !== token.pool) continue;
    matched++;
    const sell = data.tradeDirection === 0,
      result = data.swapResult;
    const input = BigInt(
        (result.includedFeeInputAmount ??
          data.amountIn ??
          result.actualInputAmount)!.toString(),
      ),
      output = BigInt(result.outputAmount.toString());
    const base = sell ? input : output,
      quote = sell
        ? output +
          BigInt(result.protocolFee.toString()) +
          BigInt(result.tradingFee.toString()) +
          BigInt(result.referralFee.toString())
        : input,
      decimals = token.quoteDecimals ?? (token.quote === "SOL" ? 9 : 6);
    const baseAmount = formatUnits(base, 6),
      quoteAmount = formatUnits(quote, decimals);

    const keys = transaction.transaction.message.getAccountKeys({
      accountKeysFromLookups: transaction.meta.loadedAddresses,
    });
    await db
      .insert(tokenTrades)
      .values({
        tokenId: token.id,
        signature: signature,
        eventIndex: index,
        wallet: keys.get(0)!.toBase58(),
        side: sell ? "sell" : "buy",
        baseAmount,
        quoteAmount,
        priceQuote:
          base > 0n
            ? (Number(quoteAmount) / Number(baseAmount)).toString()
            : "0",
        volumeUsd: null,
        blockTime: time,
      })
      .onConflictDoNothing();
    // Persist quote prices first; a slow historical USD feed cannot hide a trade.
    const reference = await historicalUsd(token.quote, time);
    if (reference !== null)
      await db
        .update(tokenTrades)
        .set({ volumeUsd: Number(quoteAmount) * reference })
        .where(
          and(
            eq(tokenTrades.signature, signature),
            eq(tokenTrades.venue, "dbc"),
            eq(tokenTrades.eventIndex, index),
          ),
        );
  }
  if (
    !matched &&
    transaction.meta.logMessages.some((log) => /Instruction: Swap/.test(log))
  )
    throw new Error("Unrecognized swap event");
}

const confirming = new Map<string, Promise<void>>();
export function indexConfirmedTrade(tokenId: string, signature: string) {
  const key = `${tokenId}:${signature}`;
  const pending = confirming.get(key);
  if (pending) return pending;
  const work = (async () => {
    const db = await getDatabase();
    const [token] = await db
      .select()
      .from(launchTokens)
      .where(
        and(eq(launchTokens.id, tokenId), eq(launchTokens.network, NETWORK)),
      );
    if (!token || token.status !== "active") return;
    const receipt = await readEventReceipt(
      connection(),
      signature,
      "confirmed",
    );
    if (!receipt) return; // The chart catch-up and scheduled scan retry RPC indexing lag.
    await indexTradeReceipt(token, signature, receipt);
  })().finally(() => confirming.delete(key));
  confirming.set(key, work);
  return work;
}

export async function indexPool(
  token: Token,
  runDeadline = Date.now() + 35_000,
) {
  const db = await getDatabase(),
    rpc = connection();
  const snapshot = await refreshSnapshot(token);
  if (!snapshot)
    return {
      indexed: false,
      reason: "Pool unavailable or graduated; ticker remains claimed.",
    };
  await db
    .update(poolSnapshots)
    .set({ lastIndexAttempt: new Date() })
    .where(eq(poolSnapshots.tokenId, token.id));
  const [previous] = await db
    .select()
    .from(poolSnapshots)
    .where(eq(poolSnapshots.tokenId, token.id));
  const root = await rpc.getSlot("finalized"),
    rootTime = await rpc.getBlockTime(root);
  if (!rootTime)
    return { indexed: false, reason: "Finalized chain time unavailable" };
  // Resume one history page per run. Only a fully completed scan establishes coverage.
  const rows = await rpc.getSignaturesForAddress(
    new PublicKey(token.pool),
    { before: previous.scanBefore ?? undefined, limit: 25 },
    "finalized",
  );
  const boundary = previous.cursor
    ? rows.findIndex((row) => row.signature === previous.cursor)
    : -1;
  const launchBoundary = !previous.cursor
    ? rows.findIndex((row) => row.signature === token.launchSignature)
    : -1;
  const stop =
    boundary >= 0
      ? boundary
      : launchBoundary >= 0
        ? launchBoundary + 1
        : rows.length;
  const signatures = rows.slice(0, stop);
  const complete = boundary >= 0 || launchBoundary >= 0;
  if (!complete && rows.length < 25)
    return {
      indexed: false,
      reason: "History boundary is unavailable; ticker remains claimed.",
    };
  const scanHead = previous.scanHead ?? rows[0]?.signature ?? previous.cursor;
  const scanStartedAt = previous.scanStartedAt ?? new Date(rootTime * 1000);
  let lastProcessed = previous.scanBefore;
  const checkpoint = async () =>
    db
      .update(poolSnapshots)
      .set({ scanHead, scanStartedAt, scanBefore: lastProcessed })
      .where(eq(poolSnapshots.tokenId, token.id));
  const deadline = Math.min(runDeadline, Date.now() + 25_000);
  for (const entry of signatures) {
    if (Date.now() > deadline) {
      await checkpoint();
      return {
        indexed: false,
        reason: "History scan checkpointed; continuing next run.",
      };
    }
    if (entry.err) {
      lastProcessed = entry.signature;
      continue;
    }
    const transaction = await readEventReceipt(rpc, entry.signature);
    if (
      !transaction?.meta ||
      !transaction.blockTime ||
      !transaction.meta.logMessages ||
      transaction.meta.logMessages.some((log) => log.includes("Log truncated"))
    )
      return { indexed: false, reason: "Incomplete transaction history" };
    if (transaction.meta.err) {
      lastProcessed = entry.signature;
      continue;
    }
    await indexTradeReceipt(token, entry.signature, transaction);
    lastProcessed = entry.signature;
  }
  if (!complete) {
    await checkpoint();
    return {
      indexed: false,
      reason: "History page indexed; continuing next run.",
    };
  }
  // Advance only after every transaction was fetched and parsed successfully.
  await db
    .update(poolSnapshots)
    .set({
      cursor: scanHead,
      scanBefore: null,
      scanHead: null,
      scanStartedAt: null,
      coverageStart:
        previous?.coverageStart ?? token.activatedAt ?? token.createdAt,
      indexedThrough: scanStartedAt,
    })
    .where(eq(poolSnapshots.tokenId, token.id));
  if (snapshot.dammPool)
    return indexGraduatedPool(token, snapshot.dammPool, runDeadline);
  return { indexed: true };
}
export async function releaseInactiveTickers(now = new Date()) {
  const db = await getDatabase(),
    claims = await db
      .select()
      .from(tickerClaims)
      .where(eq(tickerClaims.network, NETWORK));
  let released = 0;
  for (const claim of claims) {
    if (isReservedPlatformTicker(claim.ticker)) continue;
    const pools = await db
      .select()
      .from(launchTokens)
      .where(
        and(
          eq(launchTokens.network, NETWORK),
          eq(launchTokens.ticker, claim.ticker),
          eq(launchTokens.status, "active"),
        ),
      );
    const observations = await Promise.all(
      pools.map(async (token) => {
        const [snapshot] = await db
          .select()
          .from(poolSnapshots)
          .where(eq(poolSnapshots.tokenId, token.id));
        const start = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
            3 * 86_400_000,
        );
        const trades = await db
          .select()
          .from(tokenTrades)
          .where(
            and(
              eq(tokenTrades.tokenId, token.id),
              gte(tokenTrades.blockTime, start),
            ),
          );
        const [graduatedIndex] = snapshot?.graduated
          ? await db
              .select()
              .from(graduatedIndexes)
              .where(eq(graduatedIndexes.tokenId, token.id))
          : [];
        const graduatedCoverage =
          graduatedIndex?.coverageStart &&
          graduatedIndex.indexedThrough &&
          snapshot?.indexedThrough &&
          snapshot.indexedThrough >= graduatedIndex.coverageStart
            ? new Date(
                Math.min(
                  snapshot.indexedThrough.getTime(),
                  graduatedIndex.indexedThrough.getTime(),
                ),
              )
            : null;
        return {
          createdAt: token.activatedAt ?? token.createdAt,
          coverageStart: snapshot?.coverageStart ?? null,
          indexedThrough: snapshot?.graduated
            ? graduatedCoverage
            : (snapshot?.indexedThrough ?? null),
          hasUnknownVolume: trades.some((trade) => trade.volumeUsd === null),
          dailyVolumes: trades.map((trade) => ({
            day: trade.blockTime.toISOString().slice(0, 10),
            usd: trade.volumeUsd,
          })),
        };
      }),
    );
    if (canReleaseTicker(observations, now))
      await db.transaction(async (tx) => {
        // Conditional removal prevents a stale worker from releasing a newer claim.
        const removed = await tx
          .delete(tickerClaims)
          .where(
            and(
              eq(tickerClaims.network, NETWORK),
              eq(tickerClaims.ticker, claim.ticker),
              eq(tickerClaims.tokenId, claim.tokenId),
            ),
          )
          .returning();
        if (removed.length) {
          await tx
            .update(launchTokens)
            .set({ status: "released", releasedAt: now })
            .where(
              inArray(
                launchTokens.id,
                pools.map((pool) => pool.id),
              ),
            );
          released++;
        }
      });
  }
  return released;
}
export async function runIndexer() {
  await assertNetwork();
  const db = await getDatabase();
  const pending = await db
    .select()
    .from(transactionIntents)
    .where(
      and(
        eq(transactionIntents.network, NETWORK),
        inArray(transactionIntents.status, ["prepared", "submitted"]),
      ),
    )
    .limit(30);
  for (const intent of pending) await reconcile(intent.id, intent.wallet);
  const records = await db
    .select({ token: launchTokens })
    .from(launchTokens)
    .leftJoin(poolSnapshots, eq(poolSnapshots.tokenId, launchTokens.id))
    .where(
      and(eq(launchTokens.network, NETWORK), eq(launchTokens.status, "active")),
    )
    .orderBy(sql`${poolSnapshots.lastIndexAttempt} asc nulls first`)
    .limit(30);
  const results = [];
  const deadline = Date.now() + 35_000;
  // Completed scans can contain unknown prices. Retry a bounded sample so a
  // temporary provider outage does not leave recent volume permanently unknown.
  const missing = await db
    .select({ trade: tokenTrades, quote: launchTokens.quote })
    .from(tokenTrades)
    .innerJoin(launchTokens, eq(tokenTrades.tokenId, launchTokens.id))
    .where(
      and(
        eq(launchTokens.network, NETWORK),
        isNull(tokenTrades.volumeUsd),
        gte(tokenTrades.blockTime, new Date(Date.now() - 4 * 86_400_000)),
      ),
    )
    .orderBy(sql`random()`)
    .limit(4);
  for (const { trade, quote } of missing) {
    if (Date.now() > deadline - 15_000) break;
    const reference = await historicalUsd(quote, trade.blockTime);
    const volume =
      reference === null ? null : Number(trade.quoteAmount) * reference;
    if (volume !== null && Number.isFinite(volume) && volume >= 0)
      await db
        .update(tokenTrades)
        .set({ volumeUsd: volume })
        .where(
          and(eq(tokenTrades.id, trade.id), isNull(tokenTrades.volumeUsd)),
        );
  }
  for (const { token } of records) {
    if (Date.now() > deadline) break;
    try {
      results.push({ token: token.id, ...(await indexPool(token, deadline)) });
    } catch {
      results.push({
        token: token.id,
        indexed: false,
        reason: "RPC or price source unavailable",
      });
    }
  }
  return { results, released: await releaseInactiveTickers() };
}
