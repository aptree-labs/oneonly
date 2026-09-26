/** Isolated devnet Token2022 lifecycle. No platform config or production DB writes. */
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  FEE_ESCROW_PROGRAM,
  allocationAddress,
  configAddress,
  decodeConfig,
  decodeAllocation,
  decodeLedger,
  decodeClaimed,
  ledgerAddress,
  claimedAddress,
  claimMessage,
  claimInstructions,
  xIdHash,
} from "../src";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const local = resolve(root, ".local/fee-escrow");
const statePath = resolve(local, "lifecycle.json");
const rpc = "https://api.devnet.solana.com";
const conn = new Connection(rpc, "confirmed");
const args = new Set(process.argv.slice(2));
for (const arg of args)
  if (!["--execute", "--check"].includes(arg))
    throw new Error(`Unknown option ${arg}`);
const load = (path: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
async function main() {
  if (
    (await conn.getGenesisHash()) !==
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  )
    throw new Error("Not devnet");
  const configInfo = await conn.getAccountInfo(configAddress());
  if (!configInfo)
    throw new Error("Deploy and initialize escrow on devnet first");
  if (!args.has("--execute")) {
    console.log(
      "Devnet escrow ready. --execute signs test transactions; default check signs nothing.",
    );
    return;
  }
  const deployer = process.env.FEE_ESCROW_DEVNET_DEPLOYER;
  if (!deployer)
    throw new Error("Explicit FEE_ESCROW_DEVNET_DEPLOYER required");
  const wallet = load(deployer),
    verifier = load(resolve(local, "verifier.json"));
  if (!decodeConfig(configInfo).verifier.equals(verifier.publicKey))
    throw new Error("Wrong verifier");
  if ((await conn.getBalance(wallet.publicKey)) < 400_000_000)
    throw new Error("Need 0.4 devnet SOL for isolated lifecycle");
  process.env.SOLANA_NETWORK = "devnet";
  process.env.SOLANA_RPC_URL = rpc;
  const protocol = await import("../../protocol/src/index");
  const { TokenType } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const {
    client,
    defaultCurve,
    createLaunch,
    appendFeeAllocation,
    quoteSwap,
    buildSwap,
    buildMigration,
    tradingPool,
    buildFeeCollection,
  } = protocol;
  mkdirSync(local, { recursive: true, mode: 0o700 });
  const state: any = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : { signatures: {} };
  const save = () =>
    writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  async function send(label: string, tx: Transaction, extra: Keypair[] = []) {
    tx.instructions = tx.instructions.filter(
      (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
    );
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    );
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(wallet, ...extra);
    if (tx.serialize().length > 1232)
      throw new Error("Transaction packet too large");
    const signature = await sendAndConfirmTransaction(
      conn,
      tx,
      [wallet, ...extra],
      { commitment: "confirmed", maxRetries: 5 },
    );
    state.signatures[label] = signature;
    save();
    console.log(label, signature);
    return signature;
  }
  if (!state.config) {
    const c = Keypair.generate();
    await send(
      "create-config",
      await client().partner.createConfig({
        ...defaultCurve("SOL", 0.2, "devnet", TokenType.Token2022),
        config: c.publicKey,
        feeClaimer: wallet.publicKey,
        leftoverReceiver: wallet.publicKey,
        payer: wallet.publicKey,
        quoteMint: NATIVE_MINT,
      }),
      [c],
    );
    state.config = c.publicKey.toBase58();
    save();
  }
  process.env.DBC_CONFIG_TOKEN2022_SOL = state.config;
  if (!state.pool) {
    const mint = Keypair.generate();
    const launch = await createLaunch({
      wallet: wallet.publicKey.toBase58(),
      mint,
      quote: "SOL",
      name: "Escrow devnet",
      ticker: "FEETEST",
      uri: "https://oneonly.lol",
      amount: 0n,
      slippageBps: 100,
    });
    await appendFeeAllocation(launch.transaction, {
      wallet: wallet.publicKey.toBase58(),
      pool: launch.pool,
      config: state.config,
      mint: mint.publicKey.toBase58(),
      quoteMint: NATIVE_MINT.toBase58(),
      program: FEE_ESCROW_PROGRAM,
      recipients: [
        { xId: "900000000000000001", shareBps: 2500 },
        { xId: "900000000000000002", shareBps: 7500 },
      ],
    });
    await send("launch-token2022", launch.transaction, [mint]);
    state.pool = launch.pool;
    state.mint = mint.publicKey.toBase58();
    save();
  }
  const pool = new PublicKey(state.pool),
    mint = new PublicKey(state.mint),
    allocation = allocationAddress(pool),
    xid = xIdHash("900000000000000001");
  const info = await conn.getAccountInfo(allocation),
    mintInfo = await conn.getAccountInfo(mint);
  if (!info || !mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID))
    throw new Error("Token2022 allocation not present");
  const allocationState = decodeAllocation(info);
  if (!allocationState.pool.equals(pool) || allocationState.shares.length !== 2)
    throw new Error("Bad allocation");
  async function swap(label: string, amount: bigint, sell = false) {
    const q = await quoteSwap(state.pool, amount, sell, 100);
    await send(
      label,
      await buildSwap({
        pool: state.pool,
        wallet: wallet.publicKey.toBase58(),
        amount,
        sell,
        minimumOut: q.minimumOut,
        venue: q.venue,
      }),
    );
  }
  async function collect(label: string, venue: "dbc" | "damm-v2") {
    await send(
      label,
      new Transaction().add(
        await buildFeeCollection(
          state.pool,
          wallet.publicKey.toBase58(),
          FEE_ESCROW_PROGRAM,
          venue,
        ),
      ),
    );
  }
  async function claim(label: string) {
    const l = ledgerAddress(allocation, NATIVE_MINT),
      li = await conn.getAccountInfo(l);
    if (!li) throw new Error("Quote ledger missing");
    const cumulative = (decodeLedger(li).totalReceived * 2500n) / 10000n;
    const cs = await conn.getAccountInfo(claimedAddress(l, xid));
    const claimed = cs ? decodeClaimed(cs) : 0n;
    if (cumulative <= claimed)
      throw new Error(
        "No new claimable fee; cannot prove this lifecycle phase",
      );
    const dest = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
    let before = 0n;
    try {
      before = (await getAccount(conn, dest)).amount;
    } catch {}
    const now = BigInt(Math.floor(Date.now() / 1000));
    const payload = {
      xIdHash: xid,
      cumulativeLimit: cumulative,
      bindingVersion: 1n,
      nonce: randomBytes(32),
      issuedAt: now - 5n,
      expiresAt: now + 300n,
    };
    const key = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(verifier.secretKey.subarray(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const signature = sign(
      null,
      claimMessage(payload, allocation, NATIVE_MINT, wallet.publicKey, dest),
      key,
    );
    await send(
      label,
      new Transaction().add(
        ...claimInstructions({
          claim: payload,
          pool,
          mint: NATIVE_MINT,
          wallet: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          verifier: verifier.publicKey,
          signature,
        }),
      ),
    );
    const after = (await getAccount(conn, dest)).amount;
    if (after - before !== cumulative - claimed)
      throw new Error("Actual claim delta differs from cumulative entitlement");
    state[label] = {
      amount: (after - before).toString(),
      cumulative: cumulative.toString(),
    };
    save();
  }
  if (!state.signatures["dbc-buy"]) await swap("dbc-buy", 100_000_000n);
  if (!state.signatures["dbc-collect"]) await collect("dbc-collect", "dbc");
  if (!state.signatures["dbc-claim"]) await claim("dbc-claim");
  let market = await tradingPool(state.pool);
  if (!market.state && !market.readyToMigrate)
    await swap("final-buy", 150_000_000n);
  market = await tradingPool(state.pool);
  if (!market.state) {
    const m = await buildMigration(state.pool, wallet.publicKey.toBase58());
    await send("graduate", m.transaction, [
      m.firstPositionNftKeypair,
      m.secondPositionNftKeypair,
    ]);
  }
  if (!state.signatures["damm-buy"]) await swap("damm-buy", 1_000_000n);
  if (!state.signatures["damm-sell"])
    await swap("damm-sell", 1_000_000_000n, true);
  if (!state.signatures["postgrad-dbc-collect"])
    await collect("postgrad-dbc-collect", "dbc");
  if (!state.signatures["damm-collect"])
    await collect("damm-collect", "damm-v2");
  if (!state.signatures["damm-claim"]) await claim("damm-claim");
  console.log(
    "PASS: Token2022 atomic allocation, DBC buy/collect/claim, graduation, DAMM buy/sell/collect, cumulative second claim.",
  );
  console.log("Public receipt report:", statePath);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Lifecycle failed");
  process.exitCode = 1;
});
