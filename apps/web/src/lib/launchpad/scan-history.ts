import type { Connection } from "@solana/web3.js";
import type { EventReceipt } from "@oneonly/protocol";
import { readHistoryReceipt } from "./history-rpc";

export const HISTORY_PAGE_SIZE = 100;
const CONCURRENCY = 3;
type Entry = { signature: string; err: unknown };

/** Pipeline slow receipt/price/database reads while retaining an ordered, gap-free cursor. */
export async function scanHistory(options: {
  rpc: Pick<Connection, "rpcEndpoint">;
  entries: Entry[];
  deadline: number;
  cursor: string | null;
  visit: (signature: string, receipt: EventReceipt) => Promise<boolean | void>;
  checkpoint: (cursor: string | null) => Promise<unknown>;
}) {
  let cursor = options.cursor;
  for (let offset = 0; offset < options.entries.length; offset += CONCURRENCY) {
    if (Date.now() >= options.deadline)
      return { complete: false, reason: "History scan checkpointed" };
    const batch = options.entries.slice(offset, offset + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (entry) => {
        if (entry.err) return { ok: true, stop: false };
        try {
          const receipt = await readHistoryReceipt(
            options.rpc,
            entry.signature,
          );
          if (!receipt?.meta || !receipt.blockTime)
            return { ok: false, reason: "Incomplete transaction history" };
          if (receipt.meta.err) return { ok: true, stop: false };
          if (
            !receipt.meta.logMessages ||
            receipt.meta.logMessages.some((log) =>
              log.includes("Log truncated"),
            )
          )
            return { ok: false, reason: "Incomplete transaction history" };
          if (Date.now() >= options.deadline)
            return { ok: false, reason: "History scan checkpointed" };
          const stop = await options.visit(entry.signature, receipt);
          return { ok: true, stop: !!stop };
        } catch (error) {
          return {
            ok: false,
            reason: "Receipt or price source unavailable",
            detail: (error instanceof Error ? error.message : "Unavailable")
              .replace(/https?:\/\/\S+/g, "[provider]")
              .slice(0, 240),
          };
        }
      }),
    );
    // Later receipts may already be stored, but a failed earlier one is retried:
    // unique receipt keys make that replay safe. Never certify coverage over a gap.
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      if (!outcome.ok) {
        if (outcome.reason !== "History scan checkpointed")
          console.warn("history-scan-paused", {
            signature: batch[i].signature,
            reason: outcome.reason,
            detail: outcome.detail,
          });
        await options.checkpoint(cursor);
        return { complete: false, reason: outcome.reason };
      }
      cursor = batch[i].signature;
      if (outcome.stop) {
        await options.checkpoint(cursor);
        return { complete: true };
      }
    }
    // Save every batch, including when a later RPC read or the function deadline fails.
    await options.checkpoint(cursor);
  }
  return { complete: true };
}
