import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { solanaNetwork, walletSessionCookieName } from "@oneonly/core";

export const X_SESSION_COOKIE = "oneonly-x-ownership";
export const X_SESSION_MAX_AGE = 24 * 60 * 60;
export const xSessionCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/api/creator-fees",
  maxAge: X_SESSION_MAX_AGE,
};
export const walletSessionCookie = () =>
  walletSessionCookieName(
    solanaNetwork(
      process.env.SOLANA_NETWORK,
      process.env.ONEONLY_ENVIRONMENT,
      process.env.STAGING_MAINNET_ENABLED,
    ),
    process.env.ONEONLY_ENVIRONMENT,
  );

type Identity = { wallet: string; xId: string; verifiedAt: number };
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const context = () => ({
  network: solanaNetwork(
    process.env.SOLANA_NETWORK,
    process.env.ONEONLY_ENVIRONMENT,
    process.env.STAGING_MAINNET_ENABLED,
  ),
  deployment:
    process.env.ONEONLY_ENVIRONMENT === "staging" ? "staging" : undefined,
  origin: new URL(process.env.LAUNCHPAD_URL || "http://localhost:3000").origin,
});
const signature = (payload: string) => {
  const secret = process.env.X_LINK_SECRET;
  if (!secret) throw new Error("X linking is unavailable.");
  return createHmac("sha256", secret)
    .update(`x-session-v1:${payload}`)
    .digest();
};

/** Issue only after verified, nonce-checked, wallet-bound OAuth completes. */
export function signXSession(identity: Identity, walletSession: string) {
  if (!walletSession) throw new Error("Wallet session required.");
  const payload = Buffer.from(
    JSON.stringify({
      ...identity,
      ...context(),
      sessionHash: digest(walletSession),
      expires: identity.verifiedAt + X_SESSION_MAX_AGE * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyXSession(
  value: string,
  identity: Identity,
  walletSession: string,
) {
  try {
    if (!walletSession || value.length > 4096) return false;
    const [payload, mac, extra] = value.split(".");
    if (!payload || !mac || extra) return false;
    const expected = signature(payload);
    const actual = Buffer.from(mac, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return false;
    const proof = JSON.parse(Buffer.from(payload, "base64url").toString());
    const scope = context();
    return (
      proof.wallet === identity.wallet &&
      proof.xId === identity.xId &&
      proof.verifiedAt === identity.verifiedAt &&
      Number.isFinite(proof.verifiedAt) &&
      proof.verifiedAt <= Date.now() &&
      proof.expires === proof.verifiedAt + X_SESSION_MAX_AGE * 1000 &&
      proof.expires > Date.now() &&
      proof.network === scope.network &&
      proof.deployment === scope.deployment &&
      proof.origin === scope.origin &&
      proof.sessionHash === digest(walletSession)
    );
  } catch {
    return false;
  }
}

/** Caller must authenticate the current wallet session (including revocation). */
export async function hasXSessionProof(identity: Identity) {
  try {
    const jar = await cookies();
    return verifyXSession(
      jar.get(X_SESSION_COOKIE)?.value || "",
      identity,
      jar.get(walletSessionCookie())?.value || "",
    );
  } catch {
    return false;
  }
}
