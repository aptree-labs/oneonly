import { LaunchError } from "@oneonly/core";
import type { CachePolicy } from "./public-cache";
type Policy = CachePolicy & { edge: number; parameters: string[] };
/** Explicit allowlist: adding a route does NOT accidentally make it public/cacheable. */
const policies: Record<string, Policy> = {
  tokens: {
    fresh: 5,
    stale: 10,
    edge: 3,
    parameters: ["sort", "pair", "age", "search", "page"],
  },
  token: { fresh: 5, stale: 10, edge: 3, parameters: [] },
  candles: {
    fresh: 5,
    stale: 10,
    edge: 3,
    parameters: ["interval", "before", "currency", "fallback"],
  },
  config: { fresh: 10, stale: 10, edge: 5, parameters: [] },
  "trade-assets": { fresh: 5, stale: 10, edge: 3, parameters: [] },
  leaderboard: { fresh: 30, stale: 15, edge: 10, parameters: ["period"] },
  office: { fresh: 10, stale: 5, edge: 3, parameters: [] },
};
export function publicPolicy(request: Request, path: string[]) {
  if (request.method !== "GET") return null;
  const policy = policies[path[0]];
  if (!policy) return null;
  if (
    path.length !==
    (["token", "candles", "trade-assets"].includes(path[0]) ? 2 : 1)
  )
    throw new LaunchError({
      message: "Invalid market-data path.",
      status: 404,
    });
  if (
    path[1] &&
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(path[1])
  )
    throw new LaunchError({
      message: "Invalid token identifier.",
      status: 404,
    });
  const params = new URL(request.url).searchParams;
  // Wallet-specific asset balances never enter the public cache, even with an empty wallet parameter.
  if (
    path[0] === "trade-assets" &&
    params.has("wallet") &&
    [...params.keys()].every((key) => key === "wallet")
  )
    return null;
  if ([...params.keys()].some((key) => !policy.parameters.includes(key)))
    throw new LaunchError({
      message: "Unexpected market-data filter.",
      status: 400,
    });
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    throw new LaunchError({
      message: "Duplicate market-data filter.",
      status: 400,
    });
  const search = params.get("search");
  if (search !== null)
    params.set("search", search.trim().replace(/^\$/, "").toLowerCase());
  if (path[0] === "leaderboard") {
    const period = params.get("period") ?? "24h";
    if (!["24h", "7d", "all"].includes(period))
      throw new LaunchError({
        message: "Invalid leaderboard period.",
        status: 400,
      });
    params.set("period", period);
  }
  params.sort();
  return { ...policy, key: `${path.join("/")}?${params}` };
}
export function publicHeaders(edge: number) {
  return {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Vercel-CDN-Cache-Control": `public, s-maxage=${edge}, stale-while-revalidate=${edge}`,
  };
}
