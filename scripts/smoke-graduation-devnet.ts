import { readFile, writeFile } from "node:fs/promises";
import {
  assertDevnet,
  connection,
  client,
  Keypair,
  PublicKey,
  defaultCurve,
  QUOTE_MINTS,
  createLaunch,
  quoteSwap,
  buildSwap,
  buildMigration,
  buildDammClaim,
  tradingPool,
  decodeTransactionEvents,
} from "../packages/protocol/src/index";
import type { Transaction } from "@solana/web3.js";
import { sendAndConfirmTransaction } from "../packages/protocol/node_modules/@solana/web3.js";

// Isolated low-threshold test configuration. Never replaces a deployed platform config.
async function main() {
  await assertDevnet();
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(await readFile(".data/devnet/deployer.json", "utf8")),
    ),
  );
  const rpc = connection();
  if ((await rpc.getBalance(wallet.publicKey)) < 500_000_000)
    throw new Error("Need 0.5 devnet SOL for the isolated graduation test.");
  async function send(tx: Transaction, signers: Keypair[] = []) {
    const signature = await sendAndConfirmTransaction(
      rpc,
      tx,
      [wallet, ...signers],
      { commitment: "confirmed" },
    );
    console.log("Confirmed", signature);
    return signature;
  }
  let pool: string;
  if (process.env.GRADUATION_RESUME === "true") {
    pool = JSON.parse(
      await readFile(".data/devnet/graduation-smoke.json", "utf8"),
    ).pool;
  } else {
    const config = Keypair.generate();
    const transaction = await client().partner.createConfig({
      ...defaultCurve("SOL", 0.2),
      config: config.publicKey,
      feeClaimer: wallet.publicKey,
      leftoverReceiver: wallet.publicKey,
      payer: wallet.publicKey,
      quoteMint: new PublicKey(QUOTE_MINTS.SOL),
    });
    await send(transaction, [config]);
    process.env.DBC_CONFIG_SOL = config.publicKey.toBase58();
    const mint = Keypair.generate();
    const launch = await createLaunch({
      wallet: wallet.publicKey.toBase58(),
      mint,
      quote: "SOL",
      name: "Graduation test",
      ticker: "GRADTEST",
      uri: "https://app.oneonly.lol",
      amount: 100_000_000n,
      slippageBps: 100,
    });
    await send(launch.transaction, [mint]);
    pool = launch.pool;
    await writeFile(
      ".data/devnet/graduation-smoke.json",
      JSON.stringify(
        {
          pool,
          mint: mint.publicKey.toBase58(),
          config: config.publicKey.toBase58(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  let market = await tradingPool(pool);
  if (!market.state && !market.readyToMigrate) {
    const quote = await quoteSwap(pool, 150_000_000n, false, 100);
    if (BigInt(quote.consumedInput) >= 150_000_000n)
      throw new Error("Expected a partial final buy.");
    await send(
      await buildSwap({
        pool,
        wallet: wallet.publicKey.toBase58(),
        amount: 150_000_000n,
        sell: false,
        minimumOut: quote.minimumOut,
        venue: quote.venue,
      }),
    );
  }
  market = await tradingPool(pool);
  if (!market.state) {
    const migration = await buildMigration(pool, wallet.publicKey.toBase58());
    await send(migration.transaction, [
      migration.firstPositionNftKeypair,
      migration.secondPositionNftKeypair,
    ]);
  }
  for (const [sell, amount] of [
    [false, 1_000_000n],
    [true, 1_000_000_000n],
  ] as const) {
    const quote = await quoteSwap(pool, amount, sell, 100);
    if (quote.venue !== "damm-v2")
      throw new Error("Trade did not route to DAMM v2");
    const signature = await send(
      await buildSwap({
        pool,
        wallet: wallet.publicKey.toBase58(),
        amount,
        sell,
        minimumOut: quote.minimumOut,
        venue: quote.venue,
      }),
    );
    const tx = await rpc.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (
      !tx ||
      !decodeTransactionEvents(tx, "damm-v2").some(
        (event) => event.name === "evtSwap2",
      )
    )
      throw new Error("DAMM swap event was not decoded");
    await writeFile(
      `.data/devnet/damm-${sell ? "sell" : "buy"}.json`,
      JSON.stringify(tx),
      { mode: 0o600 },
    );
  }
  await send(await buildDammClaim(pool, wallet.publicKey.toBase58()));
  console.log(
    "PASS: final partial buy, graduation, DAMM buy/sell, event decoding and LP fee claim.",
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Graduation test failed",
  );
  process.exitCode = 1;
});
