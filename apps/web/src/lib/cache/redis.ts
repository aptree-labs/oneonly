import { createHash } from "node:crypto";

/** Server only. Never expose these credentials through NEXT_PUBLIC variables. */
export function redisConfigured() {
  return !!(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  );
}
/** Enable only on a separately budgeted, non-evicting rate-limit store/plan. */
export function redisRateLimitsEnabled() {
  return redisConfigured() && process.env.ONEONLY_REDIS_RATE_LIMITS === "true";
}
export function redisKey(purpose: string, identity: string) {
  const scope = [
    process.env.VERCEL_PROJECT_ID || "oneonly-app",
    process.env.VERCEL_ENV || "local",
    process.env.SOLANA_NETWORK || "devnet",
  ];
  return `oneonly:${scope.join(":")}:${purpose}:${createHash("sha256").update(identity).digest("hex")}`;
}
let unavailableUntil = 0;
export async function redisCommand<T>(
  command: (string | number)[],
): Promise<T> {
  if (!redisConfigured() || unavailableUntil > Date.now())
    throw new Error("Redis unavailable");
  try {
    const response = await fetch(
      process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL!,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: AbortSignal.timeout(800),
      },
    );
    if (!response.ok) throw new Error("Redis request failed");
    const data = (await response.json()) as { result: T; error?: string };
    if (data.error) throw new Error("Redis command failed");
    return data.result;
  } catch {
    unavailableUntil = Date.now() + 10_000;
    // Deliberately exclude URLs, keys, tokens, command arguments and provider response bodies.
    console.warn("Redis unavailable; using bounded fallback for 10 seconds");
    throw new Error("Redis unavailable");
  }
}
