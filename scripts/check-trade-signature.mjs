/** Creates an off-chain trade review and signs locally with an unfunded test key.
 * The submit endpoint and every Solana broadcast method are deliberately unused. */
import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const {
  Transaction,
  VersionedTransaction,
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
} = require("@solana/web3.js");
const bs58 = require("bs58").default;
const origin = "https://app.oneonly.lol";
let cookie = "";
async function request(path, body) {
  assert(["challenge", "verify", "trade", "logout"].includes(path));
  const response = await fetch(`${origin}/api/launchpad/${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const data = await response.json();
  if (!response.ok)
    throw new Error(`${path} ${response.status}: ${data.error}`);
  return data;
}
const keys = generateKeyPairSync("ed25519");
const publicKey = new PublicKey(
  keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
);
const nonce = await request("challenge", { wallet: publicKey.toBase58() });
await request("verify", {
  id: nonce.id,
  signature: bs58.encode(
    sign(null, Buffer.from(nonce.message), keys.privateKey),
  ),
});
try {
  const intent = await request("trade", {
    tokenId: "da0aa9da-568c-4ac1-84b4-9274fe707030",
    side: "buy",
    amount: "0.00001",
    slippageBps: 100,
    settlement: "SOL",
  });
  assert.equal(intent.status, "prepared");
  const original = Buffer.from(intent.transaction, "base64");
  const rawMessage = Buffer.from(
    VersionedTransaction.deserialize(original).message.serialize(),
  );
  const transaction = Transaction.from(original);
  const budget = transaction.instructions.filter((ix) =>
    ix.programId.equals(ComputeBudgetProgram.programId),
  );
  if (process.env.CHECK_EXPLICIT_PRIORITY === "1") {
    assert.equal(budget.filter((ix) => ix.data[0] === 2).length, 1);
    assert.equal(budget.filter((ix) => ix.data[0] === 3).length, 1);
    assert.equal(intent.details.priorityFee, "0.0000014 SOL");
  }
  const before = transaction.serializeMessage();
  transaction.sign(
    Keypair.fromSeed(
      keys.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
    ),
  );
  const signed = transaction.serialize();
  const decoded = Transaction.from(signed);
  console.log(
    JSON.stringify({
      status: "PASS",
      rawMessageStable: rawMessage.equals(before),
      signedMessageStable: before.equals(decoded.serializeMessage()),
      signaturesValid: decoded.verifySignatures(),
      requiredSigners: decoded.signatures.length,
      bytes: signed.length,
      broadcast: false,
      priorityFee: intent.details.priorityFee ?? null,
    }),
  );
  assert(rawMessage.equals(before));
  assert(before.equals(decoded.serializeMessage()));
  assert(decoded.verifySignatures());
} finally {
  await request("logout", {});
}
