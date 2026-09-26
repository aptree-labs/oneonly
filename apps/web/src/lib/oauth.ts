import { readXLink } from "./x-link";
import { xLinkReturnOrigin } from "./deployment";
import { NextRequest, NextResponse } from "next/server";
export function appUrl(request: NextRequest) {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.NODE_ENV === "production")
    throw new Error("APP_URL is required for production OAuth.");
  return request.nextUrl.origin;
}
export const oauthCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth/x",
  maxAge: 600,
};
export function oauthResult(request: NextRequest, result: string) {
  let destination = new URL(`/?auth=${result}#early-access`, appUrl(request));
  try {
    const link = readXLink(
      request.cookies.get("x_app_link")?.value ?? "",
      "request",
    );
    destination = new URL(
      `${xLinkReturnOrigin()}${link.tokenId ? `/app/token/${link.tokenId}` : "/app"}?x=${result}${link.tokenId ? "#comments" : ""}`,
    );
  } catch {
    /* Ordinary early-access sign-in. */
  }
  const response = NextResponse.redirect(destination);
  response.cookies.set("x_app_link", "", { ...oauthCookie, maxAge: 0 });
  response.cookies.set("x_state", "", { ...oauthCookie, maxAge: 0 });
  response.cookies.set("x_verifier", "", { ...oauthCookie, maxAge: 0 });
  return response;
}
