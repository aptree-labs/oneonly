import { readXLink } from "@/lib/x-link";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appUrl, oauthCookie, oauthResult } from "@/lib/oauth";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!process.env.X_CLIENT_ID) return oauthResult(request, "unavailable");
  const link = request.nextUrl.searchParams.get("link");
  if (link) {
    try {
      readXLink(link, "request");
    } catch {
      return oauthResult(request, "failed");
    }
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: new URL("/api/auth/x/callback", appUrl(request)).href,
    scope: "users.read tweet.read",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set("x_app_link", link ?? "", {
    ...oauthCookie,
    maxAge: link ? 600 : 0,
  });
  response.cookies.set("x_state", state, oauthCookie);
  response.cookies.set("x_verifier", verifier, oauthCookie);
  return response;
}
