import { NETWORK } from "@oneonly/protocol";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDatabase, walletProfiles, eq } from "@oneonly/db";
import { signXLink } from "../x-link";
import { tokenById } from "./transactions";
import { rateLimit, fail } from "./auth";
export async function walletProfile(wallet: string | null) {
  if (!wallet || !process.env.X_LINK_SECRET) return null;
  const [profile] = await (
    await getDatabase()
  )
    .select({
      username: walletProfiles.xUsername,
      avatar: walletProfiles.xAvatar,
    })
    .from(walletProfiles)
    .where(eq(walletProfiles.wallet, wallet))
    .limit(1);
  return profile ?? null;
}
export async function beginXLink(wallet: string, tokenId: string) {
  if (!process.env.X_LINK_SECRET)
    return fail("X linking is not available yet.", 503);
  if (tokenId) await tokenById(tokenId);
  await rateLimit(`x-link:${wallet}`, 4);
  const nonce = randomBytes(32).toString("base64url");
  const jar = await cookies();
  const walletSession = jar.get(`oneonly-wallet-${NETWORK}`)?.value;
  if (!walletSession) return fail("Sign in with your wallet again.", 401);
  const linkCookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/launchpad/x-callback",
    maxAge: 600,
  };
  jar.set("oneonly-x-link", nonce, linkCookie);
  // The normal wallet cookie remains Strict. This short-lived, callback-only
  // cookie carries the same revocable session through X’s cross-site redirect.
  jar.set("oneonly-x-session", walletSession, linkCookie);
  const ticket = signXLink({
    purpose: "request",
    nonce,
    wallet,
    tokenId,
    expires: Date.now() + 600_000,
  });
  return {
    url: `https://oneonly.lol/api/auth/x?link=${encodeURIComponent(ticket)}`,
  };
}
