import { redisCommand, redisRateLimitsEnabled, redisKey } from "../cache/redis";
import {
  createHash,
  randomBytes,
  randomUUID,
  createPublicKey,
  verify,
} from "node:crypto";
import { cookies } from "next/headers";
import { PublicKey, NETWORK } from "@oneonly/protocol";
import {
  getDatabase,
  walletChallenges,
  walletSessions,
  apiLimits,
  eq,
  and,
  gt,
  sql,
} from "@oneonly/db";
import { LaunchError, walletChain } from "@oneonly/core";
import bs58 from "bs58";
export const fail = (message: string, status = 400): never => {
  throw new LaunchError({ message, status });
};
export const origin = () =>
  new URL(process.env.LAUNCHPAD_URL || "http://localhost:3000").origin;
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== origin())
    fail("Open One Only in its original tab and try again.", 403);
}
export async function jsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    fail("Send JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 400_000) {
      await reader.cancel();
      fail("Request is too large.", 413);
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== "object" || Array.isArray(body))
      fail("Invalid JSON.");
    return body as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON.");
  }
}
export const string = (value: unknown) =>
  typeof value === "string" ? value : fail("A required field is missing.");
export function walletAddress(value: unknown) {
  try {
    const key = new PublicKey(string(value));
    if (!PublicKey.isOnCurve(key.toBytes())) fail("Connect a signing wallet.");
    return key.toBase58();
  } catch {
    return fail("Invalid wallet address.");
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const blocked = new Map<string, number>();
export async function rateLimit(key: string, maximum = 20) {
  const denial = blocked.get(key);
  if (denial && denial > Date.now())
    fail("Too many requests. Try again in a minute.", 429);
  if (redisRateLimitsEnabled()) {
    let result: [number, number];
    try {
      // Atomic increment + expiration, no unexpired counters after interrupted requests.
      result = await redisCommand<[number, number]>([
        "EVAL",
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; return {n,redis.call('PTTL',KEYS[1])}",
        1,
        redisKey("limit-v1", key),
      ]);
      if (
        !Array.isArray(result) ||
        !Number.isFinite(result[0]) ||
        result[1] <= 0
      )
        throw new Error("Invalid limit result");
    } catch {
      // Do not silently allow spending/authentication or flood Postgres during a Redis outage.
      fail(
        "Traffic protection is temporarily unavailable. Please retry shortly.",
        503,
      );
    }
    if (result![0] > maximum) {
      blocked.set(key, Date.now() + result![1]);
      if (blocked.size > 2000) blocked.delete(blocked.keys().next().value!);
      fail("Too many requests. Try again in a minute.", 429);
    }
    return;
  }
  const db = await getDatabase(),
    now = new Date();
  const [row] = await db
    .insert(apiLimits)
    .values({ key, count: 1, expiresAt: new Date(now.getTime() + 60_000) })
    .onConflictDoUpdate({
      target: apiLimits.key,
      set: {
        count: sql`case when ${apiLimits.expiresAt} < now() then 1 else ${apiLimits.count} + 1 end`,
        expiresAt: sql`case when ${apiLimits.expiresAt} < now() then now() + interval '1 minute' else ${apiLimits.expiresAt} end`,
      },
    })
    .returning();
  if (row.count > maximum)
    fail("Too many requests. Try again in a minute.", 429);
}
export async function session(cookieName = `oneonly-wallet-${NETWORK}`) {
  const value = (await cookies()).get(cookieName)?.value;
  if (!value) return null;
  const db = await getDatabase();
  const [row] = await db
    .select()
    .from(walletSessions)
    .where(
      and(
        eq(walletSessions.hash, hash(value)),
        gt(walletSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.wallet ?? null;
}
export async function requireWallet() {
  const wallet = await session();
  if (!wallet) fail("Sign in with your wallet to continue.", 401);
  return wallet!;
}
export async function challenge(wallet: string) {
  await rateLimit(`challenge:${wallet}`, 5);
  // SIWS nonces must be alphanumeric; the database UUID contains hyphens.
  const id = randomUUID(),
    nonce = randomBytes(16).toString("hex"),
    expiresAt = new Date(Date.now() + 300_000);
  const message = `${new URL(origin()).host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to One Only on ${NETWORK}. This does not authorize a transaction.\n\nURI: ${origin()}\nVersion: 1\nChain ID: ${walletChain(NETWORK)}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
  const db = await getDatabase();
  await db.insert(walletChallenges).values({ id, wallet, message, expiresAt });
  return { id, message };
}
export async function verifyChallenge(id: string, signature: string) {
  const db = await getDatabase();
  // DELETE RETURNING consumes the nonce atomically, including invalid attempts.
  const [row] = await db
    .delete(walletChallenges)
    .where(
      and(
        eq(walletChallenges.id, id),
        gt(walletChallenges.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) fail("Sign-in expired or was already used. Sign in again.", 401);
  let valid = false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        new PublicKey(row.wallet).toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    valid = verify(null, Buffer.from(row.message), key, bs58.decode(signature));
  } catch {
    /* Invalid signature remains invalid. */
  }
  if (!valid) fail("The wallet signature could not be verified.", 401);
  const token = randomBytes(32).toString("base64url"),
    expiresAt = new Date(Date.now() + 86_400_000);
  await db
    .insert(walletSessions)
    .values({ hash: hash(token), wallet: row.wallet, expiresAt });
  (await cookies()).set(`oneonly-wallet-${NETWORK}`, token, {
    httpOnly: true,
    secure: origin().startsWith("https:"),
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
  return { wallet: row.wallet };
}
export async function logout() {
  const jar = await cookies(),
    token = jar.get(`oneonly-wallet-${NETWORK}`)?.value;
  if (token)
    await (
      await getDatabase()
    )
      .delete(walletSessions)
      .where(eq(walletSessions.hash, hash(token)));
  jar.delete(`oneonly-wallet-${NETWORK}`);
  return { wallet: null };
}
