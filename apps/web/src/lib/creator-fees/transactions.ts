import { createPrivateKey, sign } from "node:crypto";
import {
  getDatabase,
  creatorFeePools,
  creatorFeeChallenges,
  transactionIntents,
  eq,
  and,
  desc,
  sql,
} from "@oneonly/db";
import {
  connection,
  PublicKey,
  Keypair,
  Transaction,
  buildFeeCollection,
} from "@oneonly/protocol";
import {
  claimMessage,
  claimInstructions,
  allocationAddress,
  receiptAddress,
  decodeReceipt,
  xIdHash,
} from "@oneonly/fee-escrow";
import { getAssociatedTokenAddressSync } from "@oneonly/fee-escrow";
import { prepareIntent } from "../launchpad/transactions";
import { formatUnits } from "@oneonly/core";
import { verifiedFeeChallenge, FeeError } from "./service";
import { creatorFeeRuntime } from "./runtime";
import { readCreatorFeeBalances } from "./balances";

async function feePool(tokenId: string) {
  const [pool] = await (
    await getDatabase()
  )
    .select()
    .from(creatorFeePools)
    .where(
      and(
        eq(creatorFeePools.tokenId, tokenId),
        eq(creatorFeePools.network, "devnet"),
      ),
    )
    .limit(1);
  if (!pool) throw new FeeError("This token has no shared creator fees.", 404);
  return pool;
}
export async function prepareCreatorFeeCollection(
  wallet: string,
  tokenId: string,
  venue: "dbc" | "damm-v2" = "dbc",
) {
  const { program } = await creatorFeeRuntime(),
    pool = await feePool(tokenId);
  if (pool.program !== program.toBase58())
    throw new FeeError("Escrow program mismatch.", 409);
  const tx = new Transaction().add(
    await buildFeeCollection(pool.pool, wallet, program, venue),
  );
  return prepareIntent(wallet, "creator-fee-collect", tx, tokenId, {
    action: "Prepare shared creator fees",
    destination: "Shared fee vault",
    venue,
    costs: "You pay network fees and any new fee-vault account rent.",
  });
}
export async function prepareCreatorFeeClaim(
  wallet: string,
  challengeId: string,
) {
  const { program, verifier } = await creatorFeeRuntime(),
    c = await verifiedFeeChallenge(wallet, challengeId),
    pool = await feePool(c.tokenId);
  if (
    c.program !== program.toBase58() ||
    c.escrow !== allocationAddress(new PublicKey(pool.pool), program).toBase58()
  )
    throw new FeeError("Claim scope changed.", 409);
  const db = await getDatabase(),
    nonce = Buffer.from(c.code.replace(/^ONEONLY-/, ""), "hex");
  if (nonce.length !== 32)
    throw new FeeError("Invalid claim authorization.", 409);
  const receipt = await connection().getAccountInfo(
    receiptAddress(nonce, program),
    "confirmed",
  );
  if (receipt)
    throw new FeeError(
      "This claim has already been paid. Refresh your balances.",
      409,
    );
  const [existing] = await db
    .select()
    .from(transactionIntents)
    .where(
      and(
        eq(transactionIntents.wallet, wallet),
        eq(transactionIntents.network, "devnet"),
        eq(transactionIntents.kind, "creator-fee-claim"),
        sql`${transactionIntents.details}->>'challengeId' = ${challengeId}`,
      ),
    )
    .orderBy(desc(transactionIntents.createdAt))
    .limit(1);
  if (
    existing &&
    ["prepared", "submitted"].includes(existing.status) &&
    (await connection().getBlockHeight("confirmed")) <=
      existing.lastValidBlockHeight
  )
    return {
      id: existing.id,
      transaction: existing.transaction,
      details: existing.details,
      tokenId: existing.tokenId,
      status: existing.status,
      kind: existing.kind,
    };
  if (
    existing?.signature &&
    !["failed", "expired", "confirmed"].includes(existing.status)
  )
    throw new FeeError(
      "Check the pending claim before requesting another approval.",
      409,
    );
  const balance = (await readCreatorFeeBalances(c.tokenId, c.xId)).find(
    (b) => b.mint === c.mint,
  );
  if (!balance || BigInt(balance.claimedAtomic) >= BigInt(c.cumulativeAtomic))
    throw new FeeError(
      "Nothing remains for this claim. Refresh your balances.",
      409,
    );
  let signer: Keypair;
  try {
    const bytes = JSON.parse(
      process.env.CREATOR_FEE_VERIFIER_SECRET_KEY || "null",
    );
    if (
      !Array.isArray(bytes) ||
      bytes.length !== 64 ||
      !bytes.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
    )
      throw new Error();
    signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
    if (!signer.publicKey.equals(verifier)) throw new Error();
  } catch {
    throw new FeeError("Claim verification signing is not configured.", 503);
  }
  const mint = new PublicKey(c.mint),
    owner = new PublicKey(wallet),
    mintInfo = await connection().getAccountInfo(mint, "confirmed");
  if (!mintInfo) throw new FeeError("Claim asset is unavailable.", 503);
  const destination = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      mintInfo.owner,
    ),
    allocation = allocationAddress(new PublicKey(pool.pool), program);
  const args = {
    xIdHash: xIdHash(c.xId),
    cumulativeLimit: BigInt(c.cumulativeAtomic),
    bindingVersion: BigInt(c.bindingVersion),
    nonce,
    issuedAt: BigInt(Math.floor(c.createdAt.getTime() / 1000)),
    expiresAt: BigInt(Math.floor(c.expiresAt.getTime() / 1000)),
  };
  const message = claimMessage(
    args,
    allocation,
    mint,
    owner,
    destination,
    program,
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(signer.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign(null, message, privateKey);
  const tx = new Transaction().add(
    ...claimInstructions({
      claim: args,
      pool: new PublicKey(pool.pool),
      mint,
      wallet: owner,
      tokenProgram: mintInfo.owner,
      verifier,
      signature,
      program,
    }),
  );
  const result = await prepareIntent(
    wallet,
    "creator-fee-claim",
    tx,
    c.tokenId,
    {
      action: "Claim your creator fee share",
      challengeId,
      output: `Up to ${formatUnits(c.amountAtomic, balance.decimals)} ${balance.symbol}`,
      destination: wallet,
      post: `https://x.com/i/web/status/${c.tweetId}`,
      ...(balance.symbol === "SOL"
        ? { receivedAs: "Wrapped SOL in your wallet token account" }
        : {}),
    },
  );
  await db
    .update(creatorFeeChallenges)
    .set({ status: "issued" })
    .where(
      and(
        eq(creatorFeeChallenges.id, challengeId),
        eq(creatorFeeChallenges.status, "verified"),
      ),
    );
  return result;
}
export async function reconcileCreatorFeeClaim(
  wallet: string,
  challengeId: string,
  confirmedSignature?: string,
) {
  const { program } = await creatorFeeRuntime(),
    db = await getDatabase();
  const [c] = await db
    .select()
    .from(creatorFeeChallenges)
    .where(
      and(
        eq(creatorFeeChallenges.id, challengeId),
        eq(creatorFeeChallenges.wallet, wallet),
        eq(creatorFeeChallenges.network, "devnet"),
      ),
    )
    .limit(1);
  if (!c) throw new FeeError("Claim not found.", 404);
  const nonce = Buffer.from(c.code.replace(/^ONEONLY-/, ""), "hex"),
    account = await connection().getAccountInfo(
      receiptAddress(nonce, program),
      "confirmed",
    );
  if (!account) return { confirmed: false };
  const receipt = decodeReceipt(account, program);
  if (
    c.program !== program.toBase58() ||
    receipt.allocation.toBase58() !== c.escrow ||
    receipt.wallet.toBase58() !== wallet ||
    receipt.mint.toBase58() !== c.mint ||
    !receipt.nonce.equals(nonce) ||
    receipt.amount <= 0n ||
    receipt.amount > BigInt(c.amountAtomic)
  )
    throw new FeeError("Claim receipt does not match this request.", 409);
  await db
    .update(creatorFeeChallenges)
    .set({
      status: "consumed",
      ...(confirmedSignature ? { confirmedSignature } : {}),
    })
    .where(eq(creatorFeeChallenges.id, c.id));
  return { confirmed: true, amountAtomic: receipt.amount.toString() };
}
