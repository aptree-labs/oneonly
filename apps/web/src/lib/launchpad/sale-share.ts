import {
  getDatabase,
  transactionIntents,
  poolSnapshots,
  graduatedIndexes,
  tokenTrades,
  eq,
  and,
  asc,
  lte,
} from "@oneonly/db";
import {
  connection,
  NETWORK,
  canonicalSwapEvents,
  decodeTransactionEvents,
  quoteMultiplier,
} from "@oneonly/protocol";
import { formatUnits } from "@oneonly/core";
import { tokenById } from "./transactions";
import { fail } from "./auth";
import { saleCostBasis, saleReturn, type SaleShare } from "../sale-pnl";

const cache = new Map<string, { expires: number; value: Promise<SaleShare> }>();
export async function saleShare(
  tokenId: string,
  saleId: string,
): Promise<SaleShare> {
  if (![tokenId, saleId].every((id) => /^[0-9a-f-]{36}$/.test(id)))
    return fail("Sale not found.", 404);
  const key = `${NETWORK}:${tokenId}:${saleId}`;
  const prior = cache.get(key);
  if (prior && prior.expires > Date.now()) return prior.value;
  const value = readSale(tokenId, saleId);
  const entry = { expires: Date.now() + 5000, value };
  cache.set(key, entry);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  try {
    const result = await value;
    entry.expires = Date.now() + (result.status === "pending" ? 2500 : 60000);
    return result;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}
async function readSale(tokenId: string, saleId: string): Promise<SaleShare> {
  const db = await getDatabase();
  const [intent] = await db
    .select()
    .from(transactionIntents)
    .where(
      and(
        eq(transactionIntents.id, saleId),
        eq(transactionIntents.tokenId, tokenId),
        eq(transactionIntents.network, NETWORK),
        eq(transactionIntents.kind, "trade"),
        eq(transactionIntents.status, "confirmed"),
      ),
    );
  if (!intent?.signature || intent.details.side !== "sell")
    return fail("Confirmed sale not found.", 404);
  const token = await tokenById(tokenId);
  const empty: SaleShare = {
    status: "pending",
    wallet: intent.wallet,
    signature: intent.signature,
    quote: token.quote,
    quantity: null,
    proceeds: null,
    costBasis: null,
    pnl: null,
    percent: null,
    reason: "Calculating your sale…",
  };
  const [snapshot] = await db
    .select()
    .from(poolSnapshots)
    .where(eq(poolSnapshots.tokenId, tokenId));
  const tx = await connection().getTransaction(intent.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) return empty;
  if (
    !tx.meta ||
    tx.meta.err ||
    !tx.blockTime ||
    Buffer.from(tx.transaction.message.serialize()).toString("base64") !==
      intent.message
  )
    return {
      ...empty,
      status: "unavailable",
      reason: "Sale receipt could not be verified.",
    };
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta.loadedAddresses,
  });
  if (
    !Array.from(
      { length: tx.transaction.message.header.numRequiredSignatures },
      (_, i) => keys.get(i)?.toBase58(),
    ).includes(intent.wallet)
  )
    return fail("Sale wallet does not match.", 404);
  const balance = (rows: typeof tx.meta.preTokenBalances) =>
    (rows ?? [])
      .filter((row) => row.owner === intent.wallet && row.mint === token.mint)
      .reduce((total, row) => total + BigInt(row.uiTokenAmount.amount), 0n);
  const pre = balance(tx.meta.preTokenBalances),
    sold = pre - balance(tx.meta.postTokenBalances);
  const events = (["dbc", "damm-v2"] as const)
    .flatMap((venue) => canonicalSwapEvents(decodeTransactionEvents(tx, venue)))
    .filter(
      (event) =>
        ["evtSwap", "evtSwap2"].includes(event.name) &&
        [token.pool, snapshot?.dammPool].includes(event.data.pool?.toString()),
    );
  if (events.length !== 1 || events[0].data.tradeDirection !== 0 || sold <= 0n)
    return {
      ...empty,
      status: "unavailable",
      reason: "Sale amounts could not be verified.",
    };
  const event = events[0].data;
  const input = BigInt(
    (
      event.swapResult.includedFeeInputAmount ??
      event.amountIn ??
      event.swapResult.actualInputAmount
    ).toString(),
  );
  const proceeds = BigInt(event.swapResult.outputAmount.toString());
  if (input !== sold || proceeds < 0n)
    return {
      ...empty,
      status: "unavailable",
      reason: "Sale amounts could not be verified.",
    };
  const decimals = token.quoteDecimals ?? (token.quote === "SOL" ? 9 : 6);
  const scale = await quoteMultiplier(token.quote);
  // Cost accounting stays in raw units. Display all values at the same stock scale.
  const display = (raw: string) =>
    scale === 1 ? raw : (Number(raw) * scale).toString();
  const result = {
    ...empty,
    quantity: formatUnits(sold, 6),
    proceeds: display(formatUnits(proceeds, decimals)),
  };
  const [graduated] = snapshot?.dammPool
    ? await db
        .select()
        .from(graduatedIndexes)
        .where(eq(graduatedIndexes.tokenId, tokenId))
    : [];
  const complete =
    snapshot?.coverageStart &&
    snapshot.indexedThrough &&
    (snapshot.dammPool
      ? graduated?.coverageStart &&
        graduated.indexedThrough &&
        graduated.indexedThrough.getTime() >= tx.blockTime * 1000
      : snapshot.indexedThrough.getTime() >= tx.blockTime * 1000);
  if (!complete) return { ...result, reason: "Syncing purchase history…" };
  const trades = await db
    .select()
    .from(tokenTrades)
    .where(
      and(
        eq(tokenTrades.tokenId, tokenId),
        eq(tokenTrades.wallet, intent.wallet),
        lte(tokenTrades.blockTime, new Date(tx.blockTime * 1000)),
      ),
    )
    .orderBy(
      asc(tokenTrades.blockTime),
      asc(tokenTrades.signature),
      asc(tokenTrades.eventIndex),
    )
    .limit(5001);
  const cost =
    trades.length > 5000
      ? null
      : saleCostBasis(trades, {
          signature: intent.signature,
          quantity: sold,
          preBalance: pre,
          quoteDecimals: decimals,
        });
  if (cost === null)
    return {
      ...result,
      status: "unavailable",
      reason:
        "P&L unavailable — purchase history is incomplete or tokens were transferred.",
    };
  const profit = saleReturn(proceeds, cost, decimals);
  return {
    ...result,
    ...profit,
    costBasis: display(profit.costBasis),
    pnl: display(profit.pnl),
    status: "ready",
    reason: undefined,
  };
}
