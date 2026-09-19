import { expect, it } from "vitest";
import {
  VersionedMessage,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { canonicalSwapEvents, decodeTransactionEvents } from "./index";
import { verifiedPurchase } from "./purchase";
import fixture from "./fixtures/devnet-swap.json";
function receipt() {
  const message = VersionedMessage.deserialize(
    Buffer.from(fixture.message, "base64"),
  );
  const wallet = message.getAccountKeys().get(0)!.toBase58();
  const mint = "test-base-mint";
  const tx = {
    transaction: { message },
    meta: {
      err: null,
      innerInstructions: fixture.innerInstructions,
      logMessages: fixture.logMessages,
      preTokenBalances: [],
      postTokenBalances: [
        { owner: wallet, mint, uiTokenAmount: { amount: "369828736794" } },
      ],
    },
  } as unknown as VersionedTransactionResponse;
  const pool = canonicalSwapEvents(
    decodeTransactionEvents(tx),
  )[0].data.pool.toString();
  return { tx, expected: { wallet, mint, pool, message: fixture.message } };
}
it("verifies a purchased token received by the reviewed wallet", () => {
  const { tx, expected } = receipt();
  expect(verifiedPurchase(tx, expected)).toBe(true);
});
it("rejects failed transactions, transfer-only receipts, wrong wallets, wrong pools, and changed messages", () => {
  for (const mutation of [
    "failed",
    "transfer",
    "wallet",
    "pool",
    "message",
    "no-gain",
  ]) {
    const { tx, expected } = receipt();
    if (mutation === "failed")
      tx.meta!.err = { InstructionError: [0, "InvalidArgument"] };
    if (mutation === "transfer") {
      tx.meta!.innerInstructions = [];
      tx.meta!.logMessages = [];
    }
    if (mutation === "wallet") expected.wallet = "different-wallet";
    if (mutation === "pool") expected.pool = "different-pool";
    if (mutation === "message") expected.message = "different-message";
    if (mutation === "no-gain")
      tx.meta!.preTokenBalances = tx.meta!.postTokenBalances;
    expect(verifiedPurchase(tx, expected), mutation).toBe(false);
  }
});
