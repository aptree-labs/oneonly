import { NextRequest, NextResponse } from "next/server";
import { getDatabase, walletProfiles } from "@oneonly/db";
import { readXLink, safeXAvatar } from "@/lib/x-link";
import {
  signXSession,
  walletSessionCookie,
  X_SESSION_COOKIE,
  xSessionCookieOptions,
} from "@/lib/x-session";
import { origin, session } from "@/lib/launchpad/auth";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let tokenId = "",
    returnTo: "/app/creator-fees" | undefined,
    result = "failed",
    ownership: string | undefined;
  try {
    const data = readXLink(
      request.nextUrl.searchParams.get("profile") ?? "",
      "profile",
    );
    tokenId = data.tokenId;
    returnTo = data.returnTo;
    const currentWallet = await session();
    const linkWallet = currentWallet ?? (await session("oneonly-x-session"));
    if (
      request.cookies.get("oneonly-x-link")?.value !== data.nonce ||
      linkWallet !== data.wallet
    )
      throw new Error("X link session expired.");
    const walletSession = request.cookies.get(
      currentWallet ? walletSessionCookie() : "oneonly-x-session",
    )?.value;
    if (!walletSession) throw new Error("X link session expired.");
    const linkedAt = new Date();
    await (
      await getDatabase()
    )
      .insert(walletProfiles)
      .values({
        wallet: data.wallet,
        linkedAt,
        xId: data.xId!,
        xUsername: data.username!,
        xAvatar: safeXAvatar(data.avatar),
      })
      .onConflictDoUpdate({
        target: walletProfiles.wallet,
        set: {
          xId: data.xId!,
          xUsername: data.username!,
          xAvatar: safeXAvatar(data.avatar),
          linkedAt,
        },
      });
    ownership = signXSession(
      { wallet: data.wallet, xId: data.xId!, verifiedAt: linkedAt.getTime() },
      walletSession,
    );
    result = "linked";
  } catch {
    /* Keep failed or conflicting identities unlinked. */
  }
  const response = NextResponse.redirect(
    new URL(
      `${returnTo ?? (tokenId ? `/app/token/${tokenId}` : "/app")}?x=${result}${!returnTo && tokenId ? "#comments" : ""}`,
      origin(),
    ),
  );
  if (ownership)
    response.cookies.set(X_SESSION_COOKIE, ownership, {
      ...xSessionCookieOptions,
      secure: origin().startsWith("https:"),
    });
  response.cookies.set("oneonly-x-link", "", {
    path: "/api/launchpad/x-callback",
    maxAge: 0,
  });
  response.cookies.set("oneonly-x-session", "", {
    path: "/api/launchpad/x-callback",
    maxAge: 0,
  });
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
