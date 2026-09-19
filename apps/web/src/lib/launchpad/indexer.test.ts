import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  launchTokens,
  tokenTrades,
  poolSnapshots,
  tickerClaims,
  eq,
} from "@oneonly/db";
import { MessageV0, PublicKey, VersionedMessage } from "@solana/web3.js";
import {
  BN,
  canonicalSwapEvents,
  decodeTransactionEvents,
} from "@oneonly/protocol";
import fixture from "../../../../../packages/protocol/src/fixtures/devnet-swap.json";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const mock = vi.hoisted(() => ({
  rpc: {} as any,
  market: {} as any,
  historical: vi.fn().mockResolvedValue(100),
}));
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<typeof import("@oneonly/db")>()),
  getDatabase: async () => local.db,
}));
vi.mock("@oneonly/protocol", async (original) => ({
  ...(await original<typeof import("@oneonly/protocol")>()),
  connection: () => mock.rpc,
  tradingPool: async () => mock.market,
}));
vi.mock("./price", () => ({ historicalUsd: mock.historical }));
import {
  indexPool,
  indexTradeReceipt,
  releaseInactiveTickers,
} from "./indexer";
beforeAll(async () => {
  local = await createLocalDatabase();
});
afterAll(async () => {
  await local.client.close();
});

it("indexes v0 swap receipts with lookup tables and completes history coverage", async () => {
  const original = VersionedMessage.deserialize(
    Buffer.from(fixture.message, "base64"),
  );
  const message = new MessageV0({
    header: original.header,
    staticAccountKeys: original.staticAccountKeys,
    recentBlockhash: original.recentBlockhash,
    compiledInstructions: original.compiledInstructions,
    addressTableLookups: [
      {
        accountKey: PublicKey.default,
        writableIndexes: [0],
        readonlyIndexes: [],
      },
    ],
  });
  const receipt = {
    blockTime: 1789680000,
    transaction: { message },
    meta: {
      err: null,
      logMessages: fixture.logMessages,
      innerInstructions: fixture.innerInstructions,
      loadedAddresses: { writable: [PublicKey.default], readonly: [] },
    },
  } as any;
  expect(() => message.getAccountKeys()).toThrow(/not resolved/);
  const pool = canonicalSwapEvents(
    decodeTransactionEvents(receipt),
  )[0].data.pool.toString();
  const [token] = await local.db
    .insert(launchTokens)
    .values({
      id: randomUUID(),
      network: "devnet",
      ticker: "LOOKUP",
      name: "Lookup",
      description: "",
      imageId: randomUUID(),
      creator: message.staticAccountKeys[0].toBase58(),
      quote: "SOL",
      quoteDecimals: 9,
      mint: randomUUID(),
      pool,
      config: randomUUID(),
      status: "active",
      launchSignature: "launch",
      activatedAt: new Date(1789670000000),
    })
    .returning();
  mock.market = {
    virtual: {
      poolState: {
        sqrtPrice: new BN("18446744073709551616"),
        quoteReserve: new BN(100000000),
        creatorQuoteFee: new BN(0),
        isMigrated: 0,
      },
    },
    config: { migrationQuoteThreshold: new BN(85000000000) },
    state: null,
    address: PublicKey.default,
    readyToMigrate: false,
  };
  mock.rpc = {
    getSlot: async () => 123,
    getBlockTime: async () => 1789690000,
    getSignaturesForAddress: async () => [
      { signature: "swap", err: null },
      { signature: "launch", err: null },
    ],
    getTransaction: async (sig: string) =>
      sig === "swap"
        ? receipt
        : {
            ...receipt,
            meta: { ...receipt.meta, innerInstructions: [], logMessages: [] },
          },
  };
  expect(await indexPool(token)).toEqual({ indexed: true });
  const trades = await local.db.select().from(tokenTrades);
  expect(trades).toHaveLength(1);
  expect(trades[0].wallet).toBe(message.staticAccountKeys[0].toBase58());
  expect(trades[0].volumeUsd).toBeGreaterThan(0);
  const [snapshot] = await local.db.select().from(poolSnapshots);
  expect(snapshot.indexedThrough?.getTime()).toBe(1789690000000);
  // First-buy charts become available before external USD enrichment completes.
  let finish!: (value: number | null) => void;
  mock.historical.mockReturnValueOnce(
    new Promise<number | null>((resolve) => {
      finish = resolve;
    }),
  );
  const indexing = indexTradeReceipt(token, "first-buy", receipt);
  await vi.waitFor(async () => {
    const rows = await local.db.select().from(tokenTrades);
    expect(rows.find((r) => r.signature === "first-buy")?.priceQuote).toBe(
      trades[0].priceQuote,
    );
  });
  finish(100);
  await indexing;
  mock.historical.mockResolvedValueOnce(null);
  await indexTradeReceipt(token, "first-buy", receipt);
  const updated = await local.db.select().from(tokenTrades);
  expect(updated).toHaveLength(2);
  expect(
    updated.find((r) => r.signature === "first-buy")?.volumeUsd,
  ).toBeGreaterThan(0);
  await expect(
    indexTradeReceipt(token, "failed", {
      ...receipt,
      meta: { ...receipt.meta, err: { failure: true } },
    }),
  ).rejects.toThrow("Incomplete");
});

it("continues a pool scan past version-1 trades and reaches the launch boundary", async () => {
  const { default: sample } =
    await import("../../../../../packages/protocol/src/fixtures/mainnet-v1-swap.json");
  const [token] = await local.db
    .insert(launchTokens)
    .values({
      id: randomUUID(),
      network: "devnet",
      ticker: "V1TEST",
      name: "V1",
      description: "",
      imageId: randomUUID(),
      creator: sample.receipt.transaction.message.accountKeys[0],
      quote: "SOL",
      quoteDecimals: 9,
      mint: randomUUID(),
      pool: "6i2HFFgZ3GvMBLqiqTVvbsZe9o9ZTYmGz3w54Z9wxEKN",
      config: randomUUID(),
      status: "active",
      launchSignature: "v1launch",
      activatedAt: new Date(1789813200000),
    })
    .returning();
  mock.historical.mockResolvedValue(100);
  mock.rpc = {
    rpcEndpoint: "https://example.invalid",
    getSlot: async () => 123,
    getBlockTime: async () => 1789814000,
    getSignaturesForAddress: async () => [
      { signature: sample.signature, err: null },
      { signature: "v1launch", err: null },
    ],
    getTransaction: async (sig: string) => {
      if (sig === sample.signature)
        throw new Error(
          "Transaction version (1) is not supported by the requesting client",
        );
      return {
        blockTime: 1789813219,
        transaction: {
          message: VersionedMessage.deserialize(
            Buffer.from(fixture.message, "base64"),
          ),
        },
        meta: { err: null, logMessages: [], innerInstructions: [] },
      };
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ result: sample.receipt })),
  );
  try {
    expect(await indexPool(token)).toEqual({ indexed: true });
    const trades = await local.db.select().from(tokenTrades);
    expect(trades.filter((row) => row.tokenId === token.id)).toHaveLength(1);
    const snapshots = await local.db.select().from(poolSnapshots);
    expect(
      snapshots
        .find((row) => row.tokenId === token.id)
        ?.indexedThrough?.getTime(),
    ).toBe(1789814000000);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps the platform ticker permanently reserved while releasing ordinary inactive tickers", async () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const createdAt = new Date("2026-09-01T00:00:00Z");
  for (const ticker of ["ONEONLY", "QUIETCOIN"]) {
    const id = randomUUID();
    await local.db.insert(launchTokens).values({
      id,
      network: "devnet",
      ticker,
      name: ticker,
      description: "",
      imageId: randomUUID(),
      creator: PublicKey.default.toBase58(),
      quote: "SOL",
      quoteDecimals: 9,
      mint: randomUUID(),
      pool: randomUUID(),
      config: randomUUID(),
      status: "active",
      createdAt,
      activatedAt: createdAt,
    });
    await local.db
      .insert(tickerClaims)
      .values({ network: "devnet", ticker, tokenId: id });
    await local.db.insert(poolSnapshots).values({
      tokenId: id,
      priceQuote: "0.01",
      marketCapQuote: "100",
      quoteReserve: "0",
      progress: 0,
      creatorQuoteFee: "0",
      coverageStart: createdAt,
      indexedThrough: now,
    });
  }
  expect(await releaseInactiveTickers(now)).toBe(1);
  const claims = await local.db.select().from(tickerClaims);
  expect(claims.some((claim) => claim.ticker === "ONEONLY")).toBe(true);
  expect(claims.some((claim) => claim.ticker === "QUIETCOIN")).toBe(false);
  const [official] = await local.db
    .select()
    .from(launchTokens)
    .where(eq(launchTokens.ticker, "ONEONLY"));
  expect(official.status).toBe("active");
});
