import { NextRequest, NextResponse } from "next/server";
import { getDatabase, walletProfiles } from "@oneonly/db";
import { readXLink, safeXAvatar } from "@/lib/x-link";
import { origin, session } from "@/lib/launchpad/auth";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let tokenId = "",
    result = "failed";
  try {
    const data = readXLink(
      request.nextUrl.searchParams.get("profile") ?? "",
      "profile",
    );
    tokenId = data.tokenId;
    const currentWallet = await session();
    const linkWallet = currentWallet ?? (await session("oneonly-x-session"));
    if (
      request.cookies.get("oneonly-x-link")?.value !== data.nonce ||
      linkWallet !== data.wallet
    )
      throw new Error("X link session expired.");
    await (
      await getDatabase()
    )
      .insert(walletProfiles)
      .values({
        wallet: data.wallet,
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
          linkedAt: new Date(),
        },
      });
    result = "linked";
  } catch {
    /* Keep failed or conflicting identities unlinked. */
  }
  const response = NextResponse.redirect(
    new URL(
      `${tokenId ? `/app/token/${tokenId}` : "/app"}?x=${result}${tokenId ? "#comments" : ""}`,
      origin(),
    ),
  );
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
