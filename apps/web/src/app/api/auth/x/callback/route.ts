import { readXLink, signXLink, safeXAvatar } from "@/lib/x-link";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { saveSignup } from "@oneonly/db";
import { appUrl, oauthResult, oauthCookie } from "@/lib/oauth";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("x_state")?.value;
  const verifier = request.cookies.get("x_verifier")?.value;
  const code = request.nextUrl.searchParams.get("code");
  if (
    !state ||
    !expected ||
    Buffer.byteLength(state) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) ||
    !verifier
  )
    return oauthResult(request, "failed");
  if (request.nextUrl.searchParams.has("error"))
    return oauthResult(request, "cancelled");
  if (!code || !process.env.X_CLIENT_ID) return oauthResult(request, "failed");
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (process.env.X_CLIENT_SECRET)
      headers.Authorization = `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`;
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: process.env.X_CLIENT_ID,
        redirect_uri: new URL("/api/auth/x/callback", appUrl(request)).href,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!tokenResponse.ok) throw new Error("Token exchange failed");
    const token = await tokenResponse.json();
    if (typeof token.access_token !== "string")
      throw new Error("Missing access token");
    const profileResponse = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      },
    );
    if (!profileResponse.ok) throw new Error("Profile lookup failed");
    const profile = await profileResponse.json();
    if (
      typeof profile.data?.id !== "string" ||
      typeof profile.data?.username !== "string"
    )
      throw new Error("Invalid profile");
    const linked = request.cookies.get("x_app_link")?.value;
    if (linked) {
      const data = readXLink(linked, "request");
      const assertion = signXLink({
        ...data,
        purpose: "profile",
        xId: profile.data.id,
        username: profile.data.username,
        avatar: safeXAvatar(profile.data.profile_image_url),
      });
      const response = NextResponse.redirect(
        new URL(
          `/api/launchpad/x-callback?profile=${encodeURIComponent(assertion)}`,
          "https://app.oneonly.lol",
        ),
      );
      for (const name of ["x_state", "x_verifier", "x_app_link"])
        response.cookies.set(name, "", { ...oauthCookie, maxAge: 0 });
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    await saveSignup({
      xId: profile.data.id,
      xUsername: profile.data.username,
    });
    return oauthResult(request, "success");
  } catch {
    return oauthResult(request, "failed");
  }
}
