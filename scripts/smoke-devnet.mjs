import { readFile, writeFile } from "node:fs/promises";
import { createPrivateKey, sign } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json")),
  { Keypair, Transaction } = require("@solana/web3.js"),
  bs58 = require("bs58").default;
const base = process.env.SMOKE_APP_URL || "http://localhost:3000",
  wallet = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(await readFile(".data/devnet/deployer.json", "utf8")),
    ),
  );
const quote = process.env.SMOKE_QUOTE || "SOL";
if (!["SOL", "USDC"].includes(quote))
  throw new Error("SMOKE_QUOTE must be SOL or USDC.");
const reportPath =
  quote === "USDC"
    ? ".data/devnet/last-smoke-usdc.json"
    : ".data/devnet/last-smoke.json";
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(wallet.secretKey.slice(0, 32)),
  ]),
  format: "der",
  type: "pkcs8",
});
let cookie = "";
async function api(path, body) {
  const response = await fetch(`${base}/api/launchpad/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const result = await response.json();
  if (!response.ok)
    throw new Error(`${path} (${response.status}): ${result.error}`);
  return result;
}
async function send(intent) {
  if (!intent.transaction) throw new Error("No prepared transaction");
  const tx = Transaction.from(Buffer.from(intent.transaction, "base64"));
  tx.partialSign(wallet);
  let status = await api("submit", {
    id: intent.id,
    transaction: tx.serialize().toString("base64"),
  });
  console.log(
    `${intent.details.action || intent.details.side || "launch"}: ${status.signature}`,
  );
  for (let attempt = 0; attempt < 35; attempt++) {
    if (status.status === "confirmed") return status;
    if (["failed", "expired"].includes(status.status))
      throw new Error(JSON.stringify(status));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    status = await api(`intent/${intent.id}`);
  }
  throw new Error(`Confirmation pending for ${intent.id}`);
}
const activeConfig = await api("config");
if (activeConfig.network !== "devnet")
  throw new Error("This test-only wallet must never sign on mainnet.");
const nonce = await api("challenge", { wallet: wallet.publicKey.toBase58() });
await api("verify", {
  id: nonce.id,
  signature: bs58.encode(sign(null, Buffer.from(nonce.message), key)),
});
console.log("Wallet challenge verified.");
let launch;
if (process.env.SMOKE_RESUME === "true") {
  launch = JSON.parse(await readFile(reportPath, "utf8"));
  if (launch.base !== base || (launch.quote || "SOL") !== quote)
    throw new Error(
      "Saved smoke test does not match this app and quote asset.",
    );
} else {
  const image = await api("image", {
    data: (await readFile("apps/web/public/brand/logo-256.webp")).toString(
      "base64",
    ),
  });
  const ticker = `T${Date.now().toString().slice(-8)}`;
  const prepared = await api("launch", {
    ticker,
    name: "One Only devnet test",
    description:
      "An end-to-end test token for One Only on Solana devnet. Test tokens have no monetary value.",
    imageId: image.id,
    quote,
    initialBuy: quote === "USDC" ? "5" : "0.07",
    slippageBps: 100,
  });
  launch = await send(prepared);
  console.log(`Token ${ticker}: ${launch.tokenId}`);
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        base,
        quote,
        ticker,
        tokenId: launch.tokenId,
        launchSignature: launch.signature,
      },
      null,
      2,
    ),
  );
}
if (
  process.env.SMOKE_CLAIM_ONLY !== "true" &&
  process.env.SMOKE_SELL_ONLY !== "true"
) {
  const buy = await api("trade", {
    tokenId: launch.tokenId,
    side: "buy",
    amount: quote === "USDC" ? "1" : "0.01",
    slippageBps: 100,
  });
  const tampered = Transaction.from(Buffer.from(buy.transaction, "base64"));
  tampered.recentBlockhash = Keypair.generate().publicKey.toBase58();
  tampered.partialSign(wallet);
  let rejected = false;
  try {
    await api("submit", {
      id: buy.id,
      transaction: tampered.serialize().toString("base64"),
    });
  } catch (error) {
    if (error.message.includes("(400)")) rejected = true;
    else throw error;
  }
  if (!rejected)
    throw new Error("Server accepted a changed transaction message.");
  console.log("Changed transaction message rejected.");
  await send(buy);
}
if (process.env.SMOKE_CLAIM_ONLY !== "true") {
  await send(
    await api("trade", {
      tokenId: launch.tokenId,
      side: "sell",
      amount: "1000",
      slippageBps: 100,
    }),
  );
}
await send(await api("claim", { tokenId: launch.tokenId }));
const portfolio = await api("portfolio");
console.log({
  holdings: portfolio.holdings.map((token) => ({
    ticker: token.ticker,
    balance: token.balance,
  })),
  balance: portfolio.balance,
  quoteBalances: portfolio.quoteBalances,
});
console.log(
  process.env.SMOKE_CLAIM_ONLY === "true"
    ? "Fresh fee claim and holdings verified on devnet."
    : process.env.SMOKE_SELL_ONLY === "true"
      ? "Sell, fee claim, and holdings verified on devnet."
      : "Launch, buy, sell, fee claim, and holdings verified on devnet.",
);
