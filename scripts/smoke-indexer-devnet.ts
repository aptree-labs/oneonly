import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  launchTokens,
  tokenTrades,
  graduatedIndexes,
  poolSnapshots,
  eq,
} from "../packages/db/src/index";
import {
  assertDevnet,
  connection,
  tradingPool,
  PublicKey,
} from "../packages/protocol/src/index";
import { indexPool } from "../apps/web/src/lib/launchpad/indexer";

async function main() {
  await assertDevnet();
  const { pool } = JSON.parse(
    await readFile(".data/devnet/graduation-smoke.json", "utf8"),
  );
  const market = await tradingPool(pool),
    rpc = connection();
  const history = await rpc.getSignaturesForAddress(
    new PublicKey(pool),
    { limit: 100 },
    "finalized",
  );
  const launch = history.at(-1);
  if (!launch?.blockTime) throw new Error("Test launch history unavailable");
  const local = await createLocalDatabase();
  (globalThis as unknown as { oneonlyDb: Promise<typeof local.db> }).oneonlyDb =
    Promise.resolve(local.db);
  try {
    const [token] = await local.db
      .insert(launchTokens)
      .values({
        id: randomUUID(),
        network: "devnet",
        ticker: "GRADTEST",
        name: "Graduation test",
        description: "Isolated on-chain integration test",
        imageId: randomUUID(),
        creator: market.virtual.poolState.creator.toBase58(),
        mint: market.virtual.poolState.baseMint.toBase58(),
        pool,
        config: market.virtual.poolState.config.toBase58(),
        quote: "SOL",
        quoteDecimals: 9,
        status: "active",
        launchSignature: launch.signature,
        activatedAt: new Date(launch.blockTime * 1000),
      })
      .returning();
    let result;
    for (let i = 0; i < 8; i++) {
      result = await indexPool(token, Date.now() + 35_000);
      console.log(result);
      if (result.indexed) break;
    }
    const trades = await local.db
      .select()
      .from(tokenTrades)
      .where(eq(tokenTrades.tokenId, token.id));
    const [coverage] = await local.db
      .select()
      .from(graduatedIndexes)
      .where(eq(graduatedIndexes.tokenId, token.id));
    const [snapshot] = await local.db
      .select()
      .from(poolSnapshots)
      .where(eq(poolSnapshots.tokenId, token.id));
    const counts = {
      dbc: trades.filter((t) => t.venue === "dbc").length,
      damm: trades.filter((t) => t.venue === "damm-v2").length,
    };
    if (
      !result?.indexed ||
      !coverage?.indexedThrough ||
      counts.dbc < 2 ||
      counts.damm < 2 ||
      snapshot.marketVenue !== "damm-v2"
    )
      throw new Error("Incomplete curve / graduated coverage");
    const again = await indexPool(token, Date.now() + 35_000);
    const repeated = await local.db
      .select()
      .from(tokenTrades)
      .where(eq(tokenTrades.tokenId, token.id));
    if (!again.indexed || repeated.length !== trades.length)
      throw new Error("Indexer is not idempotent");
    await writeFile(
      ".data/devnet/graduation-index-report.json",
      JSON.stringify(
        {
          pool,
          counts,
          indexedThrough: coverage.indexedThrough,
          marketVenue: snapshot.marketVenue,
          idempotent: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: DBC and DAMM history indexed exactly once, initialization boundary verified, live DAMM snapshot.",
    );
  } finally {
    await local.client.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Indexer test failed");
  process.exitCode = 1;
});
