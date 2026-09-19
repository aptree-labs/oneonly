import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import {
  createLocalDatabase,
  launchTokens,
  transactionIntents,
  poolSnapshots,
  tokenTrades,
} from "@oneonly/db";
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const rpc = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<typeof import("@oneonly/db")>()),
  getDatabase: async () => local.db,
}));
vi.mock("@oneonly/protocol", () => ({
  NETWORK: "devnet",
  connection: () => ({ getTransaction: rpc.get }),
  quoteMultiplier: async () => 1,
  decodeTransactionEvents: (tx: any, venue: string) =>
    venue === "dbc" ? tx.events : [],
  canonicalSwapEvents: (events: any[]) => events,
}));
vi.mock("./transactions", () => ({
  tokenById: async (id: string) => ({
    id,
    mint: "mint",
    pool: "pool",
    quote: "SOL",
    quoteDecimals: 9,
  }),
}));
import { saleShare } from "./sale-share";
beforeAll(async () => {
  local = await createLocalDatabase();
});
afterAll(async () => {
  await local.client.close();
});
async function fixture(
  options: {
    status?: string;
    side?: string;
    mismatch?: boolean;
    transferred?: boolean;
    covered?: boolean;
  } = {},
) {
  const tokenId = randomUUID(),
    saleId = randomUUID(),
    wallet = Keypair.generate().publicKey;
  const tx = new Transaction({
    feePayer: wallet,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    SystemProgram.transfer({
      fromPubkey: wallet,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  const message = tx.compileMessage(),
    signature = randomUUID();
  const time = new Date("2026-09-19T00:01:00Z");
  await local.db
    .insert(launchTokens)
    .values({
      id: tokenId,
      network: "devnet",
      ticker: saleId.slice(0, 8),
      name: "Fixture",
      description: "",
      imageId: randomUUID(),
      creator: wallet.toBase58(),
      quote: "SOL",
      mint: tokenId,
      pool: tokenId,
      config: "fixture",
    });
  await local.db
    .insert(transactionIntents)
    .values({
      id: saleId,
      tokenId,
      network: "devnet",
      wallet: wallet.toBase58(),
      kind: "trade",
      status: options.status ?? "confirmed",
      signature,
      transaction: "fixture",
      message: options.mismatch
        ? "wrong-message"
        : Buffer.from(message.serialize()).toString("base64"),
      blockhash: "fixture",
      lastValidBlockHeight: 1,
      details: { side: options.side ?? "sell" },
    });
  await local.db
    .insert(poolSnapshots)
    .values({
      tokenId,
      priceQuote: "1",
      marketCapQuote: "1",
      quoteReserve: "1",
      progress: 1,
      creatorQuoteFee: "0",
      coverageStart: new Date(0),
      indexedThrough: options.covered === false ? new Date(0) : time,
    });
  await local.db.insert(tokenTrades).values([
    {
      tokenId,
      signature: randomUUID(),
      eventIndex: 0,
      wallet: wallet.toBase58(),
      side: "buy",
      baseAmount: options.transferred ? "90" : "100",
      quoteAmount: "0.05",
      priceQuote: "0.0005",
      blockTime: new Date(time.getTime() - 60000),
    },
    {
      tokenId,
      signature,
      eventIndex: 0,
      wallet: wallet.toBase58(),
      side: "sell",
      baseAmount: "50",
      quoteAmount: "0.08",
      priceQuote: "0.0016",
      blockTime: time,
    },
  ]);
  const balance = (amount: string) => [
    { owner: wallet.toBase58(), mint: "mint", uiTokenAmount: { amount } },
  ];
  rpc.get.mockResolvedValue({
    transaction: { message },
    blockTime: time.getTime() / 1000,
    meta: {
      err: null,
      preTokenBalances: balance("100000000"),
      postTokenBalances: balance("50000000"),
    },
    events: [
      {
        name: "evtSwap",
        data: {
          pool: "pool",
          tradeDirection: 0,
          swapResult: {
            includedFeeInputAmount: 50000000n,
            outputAmount: 75000000n,
          },
        },
      },
    ],
  });
  return { tokenId, saleId };
}
it("uses verified net proceeds, wallet history and cost of only the sold units", async () => {
  const f = await fixture();
  expect(await saleShare(f.tokenId, f.saleId)).toMatchObject({
    status: "ready",
    quantity: "50",
    proceeds: "0.075",
    costBasis: "0.025",
    pnl: "0.05",
    percent: 200,
  });
});
it("does not expose a result for another token, unconfirmed sale or buy", async () => {
  const f = await fixture();
  await expect(saleShare(randomUUID(), f.saleId)).rejects.toThrow(
    "Confirmed sale not found",
  );
  for (const options of [{ status: "submitted" }, { side: "buy" }]) {
    const next = await fixture(options);
    await expect(saleShare(next.tokenId, next.saleId)).rejects.toThrow(
      "Confirmed sale not found",
    );
  }
});
it("does not invent profit for a changed receipt or transferred tokens", async () => {
  for (const options of [{ mismatch: true }, { transferred: true }]) {
    const f = await fixture(options);
    expect(await saleShare(f.tokenId, f.saleId)).toMatchObject({
      status: "unavailable",
      pnl: null,
      costBasis: null,
    });
  }
});
it("keeps known proceeds while waiting for complete indexed history", async () => {
  const f = await fixture({ covered: false });
  expect(await saleShare(f.tokenId, f.saleId)).toMatchObject({
    status: "pending",
    proceeds: "0.075",
    pnl: null,
  });
});
