import { NextResponse, type NextRequest } from "next/server";
/** The public landing page and trading app have separate hostnames and entry points. */
export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone(),
    host = request.headers.get("host")?.split(":")[0];
  if (
    (host === "app.oneonly.lol" || process.env.ONEONLY_SURFACE === "app") &&
    url.pathname === "/"
  ) {
    url.pathname = "/app";
    return NextResponse.rewrite(url);
  }
  if (
    (host === "oneonly.lol" || host === "www.oneonly.lol") &&
    (url.pathname === "/app" || url.pathname.startsWith("/app/"))
  ) {
    url.hostname = "app.oneonly.lol";
    url.protocol = "https:";
    url.port = "";
    if (url.pathname === "/app") url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/", "/app/:path*"] };
