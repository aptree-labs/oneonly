import { createHmac, timingSafeEqual } from "node:crypto";
export type XLink = {
  purpose: "request" | "profile";
  nonce: string;
  wallet: string;
  tokenId: string;
  expires: number;
  xId?: string;
  username?: string;
  avatar?: string | null;
};
export function signXLink(value: XLink) {
  const secret = process.env.X_LINK_SECRET;
  if (!secret) throw new Error("X linking is unavailable.");
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function readXLink(value: string, purpose: XLink["purpose"]): XLink {
  if (value.length > 5000) throw new Error("Invalid X link.");
  const [payload, signature, extra] = value.split(".");
  const secret = process.env.X_LINK_SECRET;
  if (!secret || !payload || !signature || extra)
    throw new Error("Invalid X link.");
  const actual = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", secret).update(payload).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Invalid X link.");
  const data = JSON.parse(
    Buffer.from(payload, "base64url").toString(),
  ) as XLink;
  if (
    data.purpose !== purpose ||
    !Number.isFinite(data.expires) ||
    data.expires < Date.now() ||
    data.expires > Date.now() + 600_000 ||
    !/^[A-Za-z0-9_-]{43}$/.test(data.nonce) ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.wallet) ||
    typeof data.tokenId !== "string" ||
    (data.tokenId !== "" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        data.tokenId,
      ))
  )
    throw new Error("Expired or invalid X link.");
  if (
    purpose === "profile" &&
    (!/^\d+$/.test(data.xId ?? "") ||
      !/^[A-Za-z0-9_]{1,15}$/.test(data.username ?? ""))
  )
    throw new Error("Invalid X profile.");
  return data;
}
export function safeXAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "pbs.twimg.com" &&
      url.pathname.startsWith("/profile_images/")
      ? url.href
      : null;
  } catch {
    return null;
  }
}
