import { type VersionedTransactionResponse } from "@solana/web3.js";
import { canonicalSwapEvents, decodeTransactionEvents } from "./index";

/** The reviewed server intent binds the buyer and instructions. A finalized receipt must also show a real buy and receipt of the base asset. */
export function verifiedPurchase(
  tx: VersionedTransactionResponse,
  expected: {
    wallet: string;
    mint: string;
    pool: string;
    dammPool?: string | null;
    message: string;
  },
): boolean {
  if (
    !tx.meta ||
    tx.meta.err ||
    Buffer.from(tx.transaction.message.serialize()).toString("base64") !==
      expected.message
  )
    return false;
  const message = tx.transaction.message;
  const keys = message.getAccountKeys({
    accountKeysFromLookups: tx.meta.loadedAddresses,
  });
  if (
    !Array.from({ length: message.header.numRequiredSignatures }, (_, i) =>
      keys.get(i)?.toBase58(),
    ).includes(expected.wallet)
  )
    return false;
  const sum = (balances: typeof tx.meta.postTokenBalances) =>
    (balances ?? [])
      .filter(
        (balance) =>
          balance.owner === expected.wallet && balance.mint === expected.mint,
      )
      .reduce(
        (total, balance) => total + BigInt(balance.uiTokenAmount.amount),
        0n,
      );
  if (sum(tx.meta.postTokenBalances) <= sum(tx.meta.preTokenBalances))
    return false;
  return (["dbc", "damm-v2"] as const).some((venue) => {
    const pool = venue === "dbc" ? expected.pool : expected.dammPool;
    if (!pool) return false;
    return canonicalSwapEvents(decodeTransactionEvents(tx, venue)).some(
      (event) =>
        ["evtSwap", "evtSwap2"].includes(event.name) &&
        event.data.pool?.toString() === pool &&
        event.data.tradeDirection === 1 &&
        BigInt(event.data.swapResult.outputAmount.toString()) > 0n,
    );
  });
}
