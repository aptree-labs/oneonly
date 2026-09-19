import { NextResponse, type NextRequest } from "next/server";
/** The main domain serves the app; former app links remain valid. */
export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone(),
    host =
      request.headers.get("host")?.split(":")[0] ?? request.nextUrl.hostname;
  // Preserve the callback cookie for links started on the former app host.
  const legacyLinkCallback =
    url.pathname === "/api/launchpad/x-callback" &&
    request.cookies.has("oneonly-x-link");
  if (
    (host === "app.oneonly.lol" && !legacyLinkCallback) ||
    host === "www.oneonly.lol"
  ) {
    url.hostname = "oneonly.lol";
    url.protocol = "https:";
    url.port = "";
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (
    (host === "oneonly.lol" || process.env.ONEONLY_SURFACE === "app") &&
    url.pathname === "/"
  ) {
    url.pathname = "/app";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
