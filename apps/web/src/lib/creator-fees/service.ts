import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  getDatabase,
  creatorFeeProfiles,
  creatorFeeBindings,
  creatorFeePools,
  creatorFeeAllocations,
  creatorFeeChallenges,
  walletProfiles,
  launchTokens,
  eq,
  and,
  gt,
  desc,
  sql,
  type Database,
} from "@oneonly/db";
import { validateFeeRecipients } from "@oneonly/core";
import { client, PublicKey } from "@oneonly/protocol";
import { FeeError, lookupX, verifyXPost, type FeeProfile } from "./provider";
import { creatorFeeRuntime } from "./runtime";
import { readCreatorFeeBalances } from "./balances";
import { cachedFeeBalances, recipientFeeTotals } from "./projections";
export { FeeError } from "./provider";
export const feeFeatureEnabled = () =>
  process.env.ONEONLY_ENVIRONMENT === "staging" &&
  process.env.SOLANA_NETWORK === "devnet";
export function assertFeeFeature() {
  if (!feeFeatureEnabled())
    throw new FeeError(
      "Creator fee sharing is available only in the devnet preview.",
      404,
    );
}
export async function feeStatus() {
  const enabled = feeFeatureEnabled();
  let escrowAvailable = false;
  if (enabled) {
    try {
      await creatorFeeRuntime();
      escrowAvailable = true;
    } catch {
      /* fail closed */
    }
  }
  return {
    enabled,
    network: "devnet",
    lookupAvailable: enabled && !!process.env.TWITTERAPI_IO_API_KEY,
    bindingAvailable:
      enabled && !!process.env.X_LINK_SECRET && !!process.env.X_CLIENT_ID,
    escrowAvailable,
  };
}
export async function findFeeProfile(
  handle: string,
  database?: Database,
): Promise<FeeProfile> {
  assertFeeFeature();
  const profile = await lookupX(handle),
    db = database ?? (await getDatabase());
  await db
    .insert(creatorFeeProfiles)
    .values(profile)
    .onConflictDoUpdate({
      target: creatorFeeProfiles.xId,
      set: { ...profile, updatedAt: new Date() },
    });
  return profile;
}
export async function resolveFeeAllocation(
  input: unknown,
  database?: Database,
) {
  assertFeeFeature();
  const recipients = validateFeeRecipients(input),
    db = database ?? (await getDatabase());
  for (const recipient of recipients) {
    const [profile] = await db
      .select()
      .from(creatorFeeProfiles)
      .where(eq(creatorFeeProfiles.xId, recipient.xId));
    if (!profile || profile.updatedAt.getTime() < Date.now() - 24 * 3600_000)
      throw new FeeError("Look up each X recipient again before launching.");
  }
  return recipients;
}
export type RecordedFeeAllocation = {
  tokenId: string;
  network: "devnet";
  pool: string;
  mint: string;
  escrow: string;
  program: string;
  recipients: { xId: string; shareBps: number }[];
};
/** Call only after chain reconciliation verifies the escrow's actual pool authority. */
export async function recordFeeAllocation(
  input: RecordedFeeAllocation,
  database?: Database,
) {
  assertFeeFeature();
  if (input.network !== "devnet")
    throw new FeeError("Wrong allocation network.");
  const recipients = validateFeeRecipients(input.recipients);
  if (!recipients.length) throw new FeeError("Recipients are required.");
  const db = database ?? (await getDatabase());
  await db.transaction(async (tx) => {
    const { recipients: _, ...pool } = input;
    await tx.insert(creatorFeePools).values(pool).onConflictDoNothing();
    const [existing] = await tx
      .select()
      .from(creatorFeePools)
      .where(eq(creatorFeePools.tokenId, input.tokenId));
    if (
      !existing ||
      existing.network !== input.network ||
      existing.pool !== input.pool ||
      existing.mint !== input.mint ||
      existing.escrow !== input.escrow ||
      existing.program !== input.program
    )
      throw new FeeError("The fee allocation is immutable.", 409);
    for (const r of recipients)
      await tx
        .insert(creatorFeeAllocations)
        .values({ tokenId: input.tokenId, ...r })
        .onConflictDoNothing();
    const saved = await tx
      .select()
      .from(creatorFeeAllocations)
      .where(eq(creatorFeeAllocations.tokenId, input.tokenId));
    if (
      saved.length !== recipients.length ||
      saved.some(
        (s) =>
          !recipients.some((r) => r.xId === s.xId && r.shareBps === s.shareBps),
      )
    )
      throw new FeeError("The fee allocation is immutable.", 409);
  });
}
export async function bindFeeWallet(wallet: string, database?: Database) {
  assertFeeFeature();
  const db = database ?? (await getDatabase());
  // The authenticated wallet session came from a wallet signature; this profile
  // exists only after the separate X OAuth proof bound to that same session.
  const [profile] = await db
    .select()
    .from(walletProfiles)
    .where(eq(walletProfiles.wallet, wallet));
  if (!profile)
    throw new FeeError(
      "Connect your X account before binding this wallet.",
      409,
    );
  await db
    .insert(creatorFeeProfiles)
    .values({
      xId: profile.xId,
      username: profile.xUsername,
      name: profile.xUsername,
      avatar: profile.xAvatar,
    })
    .onConflictDoNothing();
  await db
    .insert(creatorFeeBindings)
    .values({ network: "devnet", wallet, xId: profile.xId })
    .onConflictDoNothing();
  const [binding] = await db
    .select()
    .from(creatorFeeBindings)
    .where(
      and(
        eq(creatorFeeBindings.network, "devnet"),
        eq(creatorFeeBindings.xId, profile.xId),
      ),
    );
  if (!binding || binding.wallet !== wallet)
    throw new FeeError(
      "This X account or wallet is already bound. Automatic reassignment is disabled.",
      409,
    );
  return binding;
}
async function bindingFor(wallet: string, db: Database) {
  const [binding] = await db
    .select()
    .from(creatorFeeBindings)
    .where(
      and(
        eq(creatorFeeBindings.network, "devnet"),
        eq(creatorFeeBindings.wallet, wallet),
      ),
    );
  if (!binding)
    throw new FeeError("Bind your verified X account and wallet first.", 409);
  return binding;
}
async function allocationsFor(xId: string, db: Database, offset = 0) {
  const rows = await db
    .select({
      tokenId: creatorFeeAllocations.tokenId,
      shareBps: creatorFeeAllocations.shareBps,
      ticker: launchTokens.ticker,
      name: launchTokens.name,
    })
    .from(creatorFeeAllocations)
    .innerJoin(
      creatorFeePools,
      eq(creatorFeePools.tokenId, creatorFeeAllocations.tokenId),
    )
    .innerJoin(launchTokens, eq(launchTokens.id, creatorFeeAllocations.tokenId))
    .where(
      and(
        eq(creatorFeePools.network, "devnet"),
        eq(creatorFeeAllocations.xId, xId),
      ),
    )
    .orderBy(creatorFeeAllocations.tokenId)
    .limit(25)
    .offset(offset);
  const allocations: Array<
    (typeof rows)[number] & {
      balances: Awaited<ReturnType<typeof readCreatorFeeBalances>>;
      balanceStatus: "available" | "unavailable";
    }
  > = [];
  for (let index = 0; index < Math.min(rows.length, 24); index += 3) {
    allocations.push(
      ...(await Promise.all(
        rows.slice(index, Math.min(index + 3, 24)).map(async (row) => {
          try {
            return {
              ...row,
              ...(await cachedFeeBalances(row.tokenId, xId)),
              balanceStatus: "available" as const,
            };
          } catch {
            return {
              ...row,
              balances: [],
              balanceStatus: "unavailable" as const,
            };
          }
        }),
      )),
    );
  }
  return { allocations, hasMore: rows.length > 24 };
}
export async function feeDashboard(
  wallet: string,
  database?: Database,
  offset = 0,
) {
  assertFeeFeature();
  const db = database ?? (await getDatabase());
  const [p] = await db
    .select()
    .from(walletProfiles)
    .where(eq(walletProfiles.wallet, wallet));
  if (p)
    await db
      .insert(creatorFeeProfiles)
      .values({
        xId: p.xId,
        username: p.xUsername,
        name: p.xUsername,
        avatar: p.xAvatar,
      })
      .onConflictDoUpdate({
        target: creatorFeeProfiles.xId,
        set: {
          username: p.xUsername,
          avatar: p.xAvatar,
          updatedAt: new Date(),
        },
      });
  const binding = await bindingFor(wallet, db).catch((error) => {
    if (error instanceof FeeError && error.status === 409) return null;
    throw error;
  });
  const [boundProfile] = binding
    ? await db
        .select()
        .from(creatorFeeProfiles)
        .where(eq(creatorFeeProfiles.xId, binding.xId))
    : [];
  return {
    wallet,
    profile:
      boundProfile ??
      (p
        ? {
            xId: p.xId,
            username: p.xUsername,
            name: p.xUsername,
            avatar: p.xAvatar,
          }
        : null),
    connectedProfile: p
      ? {
          xId: p.xId,
          username: p.xUsername,
          name: p.xUsername,
          avatar: p.xAvatar,
        }
      : null,
    binding,
    ...(binding?.xId || p?.xId
      ? await allocationsFor(binding?.xId || p!.xId, db, offset)
      : { allocations: [], hasMore: false }),
  };
}
export async function feeRecipient(
  xId: string,
  database?: Database,
  offset = 0,
) {
  assertFeeFeature();
  const db = database ?? (await getDatabase());
  const [profile] = await db
    .select()
    .from(creatorFeeProfiles)
    .where(eq(creatorFeeProfiles.xId, xId));
  if (!profile) throw new FeeError("Recipient not found.", 404);
  return { profile, ...(await allocationsFor(xId, db, offset)) };
}
export async function feeRecipients(
  query: string,
  offset: number,
  database?: Database,
) {
  assertFeeFeature();
  const db = database ?? (await getDatabase());
  const term = query.trim().replace(/^@/, "").slice(0, 100);
  const rows = await db
    .select({
      xId: creatorFeeProfiles.xId,
      username: creatorFeeProfiles.username,
      name: creatorFeeProfiles.name,
      avatar: creatorFeeProfiles.avatar,
      tokenCount: sql<number>`count(*)::int`,
    })
    .from(creatorFeeProfiles)
    .innerJoin(
      creatorFeeAllocations,
      eq(creatorFeeAllocations.xId, creatorFeeProfiles.xId),
    )
    .innerJoin(
      creatorFeePools,
      eq(creatorFeePools.tokenId, creatorFeeAllocations.tokenId),
    )
    .where(
      and(
        eq(creatorFeePools.network, "devnet"),
        sql`position(lower(${term}) in lower(${creatorFeeProfiles.username} || ' ' || ${creatorFeeProfiles.name})) > 0`,
      ),
    )
    .groupBy(creatorFeeProfiles.xId)
    .orderBy(desc(sql`count(*)`), creatorFeeProfiles.xId)
    .limit(25)
    .offset(offset);
  const totals = await recipientFeeTotals(
    rows.slice(0, 24).map((r) => r.xId),
    db,
  );
  return {
    recipients: rows.slice(0, 24).map((r) => {
      const total = totals.find((t) => t.xId === r.xId);
      return {
        ...r,
        balances: total?.balances ?? [],
        balanceStatus:
          total?.freshTokens === r.tokenCount
            ? "available"
            : total?.observedTokens
              ? "partial"
              : "unavailable",
        lastUpdated: total?.lastUpdated ?? null,
        coverage: {
          observed: total?.observedTokens ?? 0,
          fresh: total?.freshTokens ?? 0,
          total: r.tokenCount,
        },
      };
    }),
    hasMore: rows.length > 24,
  };
}
export function claimScopeHash(scope: {
  network: string;
  xId: string;
  wallet: string;
  bindingVersion: number;
  tokenId: string;
  mint: string;
  amountAtomic: string;
  cumulativeAtomic: string;
  program: string;
  escrow: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "oneonly:x-fee-claim:v1",
        scope.network,
        scope.program,
        scope.escrow,
        scope.tokenId,
        scope.mint,
        scope.xId,
        scope.wallet,
        scope.bindingVersion,
        scope.amountAtomic,
        scope.cumulativeAtomic,
      ]),
    )
    .digest("hex");
}
async function assertPoolReady(pool: typeof creatorFeePools.$inferSelect) {
  const status = await feeStatus();
  if (
    !status.escrowAvailable ||
    pool.program !== process.env.CREATOR_FEE_PROGRAM_ID
  )
    throw new FeeError(
      "Fee escrow is not available yet. Your allocation remains reserved.",
      503,
    );
  const onchain = await client().state.getPool(new PublicKey(pool.pool));
  if (!onchain || onchain.poolState.creator.toBase58() !== pool.escrow)
    throw new FeeError("The pool's fee authority has not been verified.", 503);
}
export async function createFeeChallenge(
  wallet: string,
  input: { tokenId: string; mint: string; amountAtomic: string },
  database?: Database,
) {
  assertFeeFeature();
  const db = database ?? (await getDatabase()),
    binding = await bindingFor(wallet, db);
  if (
    !/^[1-9]\d{0,19}$/.test(input.amountAtomic) ||
    BigInt(input.amountAtomic) > 18446744073709551615n
  )
    throw new FeeError("Choose a valid claim amount.");
  new PublicKey(input.mint);
  const [pool] = await db
    .select()
    .from(creatorFeePools)
    .where(
      and(
        eq(creatorFeePools.tokenId, input.tokenId),
        eq(creatorFeePools.network, "devnet"),
      ),
    );
  const [allocation] = await db
    .select()
    .from(creatorFeeAllocations)
    .where(
      and(
        eq(creatorFeeAllocations.tokenId, input.tokenId),
        eq(creatorFeeAllocations.xId, binding.xId),
      ),
    );
  if (!pool || !allocation)
    throw new FeeError(
      "No creator-fee allocation exists for this account.",
      404,
    );
  await assertPoolReady(pool);
  const balances = await readCreatorFeeBalances(input.tokenId, binding.xId);
  const balance = balances.find((row) => row.mint === input.mint);
  if (!balance || BigInt(input.amountAtomic) > BigInt(balance.amountAtomic))
    throw new FeeError(
      "The requested amount exceeds your available creator fees.",
      409,
    );
  const cumulativeAtomic = (
    BigInt(balance.claimedAtomic) + BigInt(input.amountAtomic)
  ).toString();
  const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000),
    expiresAt = new Date(createdAt.getTime() + 10 * 60_000);
  const scope = {
    ...input,
    cumulativeAtomic,
    network: "devnet",
    xId: binding.xId,
    wallet,
    bindingVersion: binding.version,
    program: pool.program,
    escrow: pool.escrow,
  };
  const challenge = {
    ...scope,
    id: randomUUID(),
    code: `ONEONLY-${randomBytes(32).toString("hex")}`,
    scopeHash: claimScopeHash(scope),
    createdAt,
    expiresAt,
  };
  await db.insert(creatorFeeChallenges).values(challenge);
  const postText = `Verifying my OneOnly devnet creator-fee claim.\n${challenge.code}`;
  return {
    id: challenge.id,
    postText,
    composeUrl: `https://x.com/intent/post?text=${encodeURIComponent(postText)}`,
    expiresAt,
    status: "pending",
  };
}
export async function verifiedFeeChallenge(
  wallet: string,
  id: string,
  database?: Database,
) {
  assertFeeFeature();
  const db = database ?? (await getDatabase()),
    binding = await bindingFor(wallet, db);
  const [c] = await db
    .select()
    .from(creatorFeeChallenges)
    .where(
      and(
        eq(creatorFeeChallenges.id, id),
        eq(creatorFeeChallenges.network, "devnet"),
        eq(creatorFeeChallenges.wallet, wallet),
      ),
    );
  if (
    !c ||
    c.xId !== binding.xId ||
    c.bindingVersion !== binding.version ||
    c.expiresAt <= new Date() ||
    c.scopeHash !== claimScopeHash(c) ||
    !["verified", "issued"].includes(c.status)
  )
    throw new FeeError("Verify a fresh post for this claim first.", 409);
  return c;
}
export async function verifyFeeChallenge(
  wallet: string,
  id: string,
  tweetUrl: string,
  database?: Database,
) {
  assertFeeFeature();
  const db = database ?? (await getDatabase()),
    binding = await bindingFor(wallet, db);
  const [c] = await db
    .select()
    .from(creatorFeeChallenges)
    .where(
      and(
        eq(creatorFeeChallenges.id, id),
        eq(creatorFeeChallenges.network, "devnet"),
        eq(creatorFeeChallenges.wallet, wallet),
      ),
    );
  if (
    !c ||
    c.xId !== binding.xId ||
    c.bindingVersion !== binding.version ||
    c.scopeHash !== claimScopeHash(c) ||
    c.status !== "pending" ||
    c.expiresAt <= new Date()
  )
    throw new FeeError(
      "This challenge expired or has already been verified.",
      409,
    );
  const proof = await verifyXPost(tweetUrl, c);
  try {
    const updated = await db
      .update(creatorFeeChallenges)
      .set({
        status: "verified",
        tweetId: proof.tweetId,
        verifiedAt: new Date(),
      })
      .where(
        and(
          eq(creatorFeeChallenges.id, id),
          eq(creatorFeeChallenges.status, "pending"),
          gt(creatorFeeChallenges.expiresAt, new Date()),
        ),
      )
      .returning();
    if (updated.length !== 1)
      throw new FeeError("This verification was already used.", 409);
  } catch (error) {
    if (error instanceof FeeError) throw error;
    throw new FeeError(
      "This post has already been used for another claim.",
      409,
    );
  }
  return {
    verified: true,
    status: "verified",
    claimReady: (await feeStatus()).escrowAvailable,
  };
}
