import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
afterEach(() => vi.unstubAllEnvs());
it("serves Explore at the main domain without bouncing back to the old host", () => {
  expect(
    proxy(new NextRequest("https://oneonly.lol/")).headers.get(
      "x-middleware-rewrite",
    ),
  ).toBe("https://oneonly.lol/app");
  expect(
    proxy(new NextRequest("https://oneonly.lol/app/create")).headers.get(
      "location",
    ),
  ).toBeNull();
});
it("preserves old links and OAuth assertions when redirecting to the main domain", () => {
  const response = proxy(
    new NextRequest(
      "https://app.oneonly.lol/api/launchpad/x-callback?profile=signed-ticket",
    ),
  );
  expect(response.headers.get("location")).toBe(
    "https://oneonly.lol/api/launchpad/x-callback?profile=signed-ticket",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("finishes a pre-migration X callback on the host holding its session cookie", () => {
  const response = proxy(
    new NextRequest(
      "https://app.oneonly.lol/api/launchpad/x-callback?profile=signed-ticket",
      { headers: { cookie: "oneonly-x-link=existing-nonce" } },
    ),
  );
  expect(response.headers.get("location")).toBeNull();
});
