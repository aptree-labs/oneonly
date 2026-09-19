import { walletProfile } from "./profile";
import {
  getDatabase,
  tokenComments,
  walletProfiles,
  tokenBuyers,
  transactionIntents,
  poolSnapshots,
  and,
  eq,
  desc,
  inArray,
  sql,
} from "@oneonly/db";
import { NETWORK, connection } from "@oneonly/protocol";
import { verifiedPurchase } from "@oneonly/protocol";
import { tokenById } from "./transactions";
import { fail, rateLimit, string } from "./auth";

export async function readComments(tokenId: string, before?: string | null) {
  await tokenById(tokenId);
  if (before && !/^[0-9a-f-]{36}$/.test(before)) fail("Invalid comment page.");
  const rows = await (
    await getDatabase()
  )
    .select()
    .from(tokenComments)
    .where(
      and(
        eq(tokenComments.tokenId, tokenId),
        before
          ? sql`(${tokenComments.createdAt}, ${tokenComments.id}) < (select created_at, id from token_comments where id = ${before} and token_id = ${tokenId})`
          : undefined,
      ),
    )
    .orderBy(desc(tokenComments.createdAt), desc(tokenComments.id))
    .limit(31);
  const profiles =
    process.env.X_LINK_SECRET && rows.length
      ? await (
          await getDatabase()
        )
          .select()
          .from(walletProfiles)
          .where(
            inArray(walletProfiles.wallet, [
              ...new Set(rows.map((row) => row.wallet)),
            ]),
          )
      : [];
  const identities = new Map(
    profiles.map((profile) => [
      profile.wallet,
      { username: profile.xUsername, avatar: profile.xAvatar },
    ]),
  );
  return {
    comments: rows
      .slice(0, 30)
      .map((row) => ({ ...row, profile: identities.get(row.wallet) ?? null })),
    next: rows.length > 30 ? rows[29].id : null,
  };
}
export async function verifyBuyer(wallet: string, tokenId: string) {
  const token = await tokenById(tokenId),
    db = await getDatabase();
  const condition = and(
    eq(tokenBuyers.tokenId, tokenId),
    eq(tokenBuyers.wallet, wallet),
  );
  const [cached] = await db.select().from(tokenBuyers).where(condition);
  if (cached) return cached;
  await rateLimit(`buyer-proof:${NETWORK}:${wallet}`, 3);
  const candidates = await db
    .select()
    .from(transactionIntents)
    .where(
      and(
        eq(transactionIntents.wallet, wallet),
        eq(transactionIntents.network, NETWORK),
        eq(transactionIntents.tokenId, tokenId),
        eq(transactionIntents.status, "confirmed"),
        sql`(${transactionIntents.kind} = 'launch' or (${transactionIntents.kind} = 'trade' and ${transactionIntents.details}->>'side' = 'buy'))`,
      ),
    )
    .orderBy(desc(transactionIntents.createdAt))
    .limit(20);
  const [snapshot] = await db
    .select()
    .from(poolSnapshots)
    .where(eq(poolSnapshots.tokenId, tokenId));
  for (const candidate of candidates
    .filter(
      (row) =>
        row.kind === "launch" ||
        (row.kind === "trade" && row.details.side === "buy"),
    )
    .slice(0, 4)) {
    if (!candidate.signature) continue;
    const tx = await connection().getTransaction(candidate.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (
      !tx ||
      !verifiedPurchase(tx, {
        wallet,
        mint: token.mint,
        pool: token.pool,
        dammPool: snapshot?.dammPool,
        message: candidate.message,
      })
    )
      continue;
    const proof = { tokenId, wallet, signature: candidate.signature };
    await db.insert(tokenBuyers).values(proof).onConflictDoNothing();
    return proof;
  }
  return fail(
    "No finalized One Only purchase was found for this wallet yet. If you just bought, wait for confirmation and try again.",
    403,
  );
}
export async function postComment(
  wallet: string,
  input: Record<string, unknown>,
) {
  const body = string(input.body).trim(),
    tokenId = string(input.tokenId);
  if (!body || body.length > 500)
    fail("Write a comment between 1 and 500 characters.");
  await rateLimit(`comment:${NETWORK}:${wallet}`, 3);
  const proof = await verifyBuyer(wallet, tokenId);
  const [comment] = await (
    await getDatabase()
  )
    .insert(tokenComments)
    .values({ tokenId, wallet, body, purchaseSignature: proof.signature })
    .returning();
  return { comment: { ...comment, profile: await walletProfile(wallet) } };
}
export async function removeComment(wallet: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) fail("Comment not found.", 404);
  const db = await getDatabase();
  const [comment] = await db
    .select()
    .from(tokenComments)
    .where(and(eq(tokenComments.id, id), eq(tokenComments.wallet, wallet)));
  if (!comment) return fail("Comment not found.", 404);
  await tokenById(comment.tokenId);
  await db
    .delete(tokenComments)
    .where(and(eq(tokenComments.id, id), eq(tokenComments.wallet, wallet)));
  return { removed: true };
}
