import { expect, it } from "vitest";
import { publicPolicy, publicHeaders } from "./public-policy";
const id = "fdae9669-d70d-4324-9663-c7b13bc868c2";
const policy = (path: string, query = "", method = "GET") =>
  publicPolicy(
    new Request(`https://example.com/${path}${query}`, { method }),
    path.split("/"),
  );
it.each([
  "session",
  "profile",
  "portfolio",
  "intent/abc",
  "ticker",
  `trade-preview/${id}`,
  "sale-share/abc",
  "office-fees",
  "comments/abc",
  "cron",
])(
  "never caches private, execution, or mutable authoritative route %s",
  (route) => {
    expect(policy(route)).toBeNull();
  },
);
it("keeps wallet balances out of shared caching, including an empty wallet", () => {
  expect(policy(`trade-assets/${id}`, "?wallet=abc")).toBeNull();
  expect(policy(`trade-assets/${id}`, "?wallet=")).toBeNull();
  expect(policy(`trade-assets/${id}`)).not.toBeNull();
});
it("never caches mutations or unexpected path suffixes", () => {
  expect(policy("tokens", "", "POST")).toBeNull();
  expect(() => policy(`token/${id}/private`)).toThrow(
    "Invalid market-data path",
  );
});
it("normalizes equivalent search keys and rejects cache-busting parameters", () => {
  expect(policy("tokens", "?sort=volume&search=%24GIDDY")?.key).toBe(
    policy("tokens", "?search=giddy&sort=volume")?.key,
  );
  expect(() => policy("tokens", "?random=123")).toThrow("Unexpected");
});
it("sets a short Vercel cache lifetime without browser persistence", () => {
  expect(publicHeaders(3)).toEqual({
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Vercel-CDN-Cache-Control": "public, s-maxage=3, stale-while-revalidate=3",
  });
});

it("rejects duplicate filters instead of bypassing the cache", () => {
  expect(() => policy("tokens", "?search=a&search=b")).toThrow("Duplicate");
});

it("limits leaderboard caching to three shared period keys", () => {
  expect(policy("leaderboard")?.key).toBe("leaderboard?period=24h");
  expect(policy("leaderboard", "?period=24h")?.key).toBe(
    policy("leaderboard")?.key,
  );
  expect(policy("leaderboard", "?period=7d")?.fresh).toBe(30);
  expect(policy("leaderboard", "?period=all")?.edge).toBe(10);
  expect(() => policy("leaderboard", "?period=1h")).toThrow(
    "Invalid leaderboard",
  );
  expect(() => policy("leaderboard", "?period=24h&period=all")).toThrow(
    "Duplicate",
  );
  expect(() => policy("leaderboard", "?wallet=abc")).toThrow("Unexpected");
  expect(() => policy("leaderboard", "?page=999")).toThrow("Unexpected");
});
