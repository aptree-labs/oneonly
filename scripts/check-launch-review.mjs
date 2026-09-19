/** API review regression only: an unfunded ephemeral wallet signs a login message.
 * Never signs a transaction, calls submit, or broadcasts to Solana.
 * Creates expiring off-chain drafts; the normal indexer releases their claims.
 * Run from an app-linked release directory, passing its explicit deployment URL.
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { Transaction } = require("@solana/web3.js");
const bs58 = require("bs58").default;
const target = new URL(process.argv[2]);
assert(
  /^oneonly-[a-z0-9]+-kade\.vercel\.app$/.test(target.hostname) ||
    target.hostname === "app.oneonly.lol",
);
const temporary = mkdtempSync(join(tmpdir(), "oneonly-review-check-"));
chmodSync(temporary, 0o700);
const cookie = join(temporary, "cookies");
writeFileSync(cookie, "", { mode: 0o600 });
const allowed = new Set([
  "config",
  "challenge",
  "verify",
  "image",
  "launch",
  "logout",
]);
function request(path, body) {
  assert(allowed.has(path), "This regression must never submit transactions");
  const args = [
    "curl",
    `/api/launchpad/${path}`,
    "--deployment",
    target.origin,
    "--scope",
    "kade",
    "--",
    "--silent",
    "--show-error",
    "--max-time",
    "45",
    "--cookie",
    cookie,
    "--cookie-jar",
    cookie,
    "-H",
    "Origin: https://app.oneonly.lol",
  ];
  if (body !== undefined) {
    const file = join(temporary, "body.json");
    writeFileSync(file, JSON.stringify(body), { mode: 0o600 });
    args.push(
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      `@${file}`,
    );
  }
  const output = execFileSync("vercel", args, {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const value = JSON.parse(output);
  if (value.error) throw new Error(`${path}: ${value.error}`);
  return value;
}
try {
  const keys = generateKeyPairSync("ed25519");
  const wallet = bs58.encode(
    keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
  const config = request("config");
  assert.equal(config.network, "mainnet-beta");
  const nonce = request("challenge", { wallet });
  assert(
    nonce.message.includes(wallet) && nonce.message.includes("mainnet-beta"),
  );
  request("verify", {
    id: nonce.id,
    signature: bs58.encode(
      sign(null, Buffer.from(nonce.message), keys.privateKey),
    ),
  });
  const image = request("image", {
    data: readFileSync(
      new URL("../apps/web/public/brand/logo-128.webp", import.meta.url),
    ).toString("base64"),
  });
  for (const symbol of (process.argv[3] || "SOL,USDC,SPYX").split(",")) {
    const quote = config.quotes.find((asset) => asset.symbol === symbol);
    assert(
      quote?.enabled && quote.displayUsdPrice > 0,
      `${symbol} quote unavailable`,
    );
    const ticker = `QA${randomBytes(4).toString("hex").toUpperCase()}`;
    const result = request("launch", {
      ticker,
      name: "Unsigned review check",
      description: "Temporary off-chain regression draft. Never broadcast.",
      imageId: image.id,
      quote: symbol,
      initialBuy: (Math.ceil((6 / quote.displayUsdPrice) * 1e6) / 1e6).toFixed(
        6,
      ),
      slippageBps: 100,
    });
    assert.equal(result.status, "prepared");
    assert.equal(result.details.network, "mainnet-beta");
    const wire = Buffer.from(result.transaction, "base64"),
      tx = Transaction.from(wire);
    assert(wire.length <= 1232);
    assert.equal(tx.feePayer.toBase58(), wallet);
    assert.equal(
      tx.signatures.find((s) => s.publicKey.toBase58() === wallet)?.signature,
      null,
    );
    assert(
      tx.signatures.some(
        (s) => s.publicKey.toBase58() !== wallet && s.signature,
      ),
    );
    assert(tx.verifySignatures(false), "Mint signature must remain valid");
    console.log(
      JSON.stringify({
        symbol,
        status: "PASS",
        review: "prepared",
        payerSigned: false,
        wireBytes: wire.length,
        ticker,
        intentId: result.id,
      }),
    );
  }
  request("logout", {});
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
