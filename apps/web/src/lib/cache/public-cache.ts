import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { unstable_cache } from "next/cache";
import { LaunchError } from "@oneonly/core";
import { redisCommand, redisConfigured, redisKey } from "./redis";

type Entry<T> = { value: T; written: number };
export type CachePolicy = { fresh: number; stale: number };
const entries = new Map<string, { data: Entry<unknown>; bytes: number }>();
const pending = new Map<string, Promise<Entry<unknown>>>();
let bytes = 0;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY = 512 * 1024;
const MAX_ACTIVE = 32;
const busy = () =>
  new LaunchError({
    message: "Market data is updating. Please retry shortly.",
    status: 503,
  });
function remember<T>(key: string, data: Entry<T>) {
  const size = Buffer.byteLength(JSON.stringify(data));
  if (size > MAX_ENTRY) return;
  bytes -= entries.get(key)?.bytes ?? 0;
  entries.delete(key);
  entries.set(key, { data, bytes: size });
  bytes += size;
  while (bytes > MAX_BYTES || entries.size > 500) {
    const oldest = entries.keys().next().value!;
    bytes -= entries.get(oldest)!.bytes;
    entries.delete(oldest);
  }
}
const valid = (entry: Entry<unknown> | undefined, seconds: number) =>
  !!entry &&
  Number.isFinite(entry.written) &&
  Date.now() >= entry.written &&
  Date.now() - entry.written < seconds * 1000;

/** Public JSON only. Never use for sessions, balances, quotes, intents or signed transactions. */
export async function publicCache<T>(
  identity: string,
  policy: CachePolicy,
  load: () => Promise<T>,
): Promise<T> {
  // Different releases/environments must not share incompatible response schemas/configuration.
  const key = redisKey(
    "public-v1",
    `${process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || "local"}:${identity}`,
  );
  let entry = entries.get(key)?.data as Entry<T> | undefined;
  if (valid(entry, policy.fresh)) return entry!.value;
  const existing = pending.get(key) as Promise<Entry<T>> | undefined;
  if (existing)
    return valid(entry, policy.fresh + policy.stale)
      ? entry!.value
      : (await existing).value;
  if (pending.size >= MAX_ACTIVE) {
    if (valid(entry, policy.fresh + policy.stale)) return entry!.value;
    throw busy();
  }
  // Register the entire operation before the first Redis await: one request per key per instance.
  const work = (async (): Promise<Entry<T>> => {
    let redisAvailable = redisConfigured();
    if (redisAvailable) {
      try {
        const raw = await redisCommand<string | null>(["GET", key]);
        if (raw) {
          const remote = JSON.parse(raw) as Entry<T>;
          if (valid(remote, policy.fresh + policy.stale)) {
            entry = remote;
            remember(key, remote);
            if (valid(remote, policy.fresh)) return remote;
          }
        }
      } catch {
        redisAvailable = false;
      }
    }
    const lockKey = `${key}:lock`,
      owner = randomUUID();
    let locked = false;
    if (redisAvailable) {
      try {
        locked =
          (await redisCommand<string | null>([
            "SET",
            lockKey,
            owner,
            "NX",
            "PX",
            20_000,
          ])) === "OK";
      } catch {
        redisAvailable = false;
      }
      if (redisAvailable && !locked) {
        if (valid(entry, policy.fresh + policy.stale)) return entry!;
        // Cold miss: bounded wait for the owner; never stampede the origin after timeout.
        for (let i = 0; i < 8; i++) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          const raw = await redisCommand<string | null>(["GET", key]);
          if (raw) {
            const value = JSON.parse(raw) as Entry<T>;
            if (valid(value, policy.fresh + policy.stale)) {
              remember(key, value);
              return value;
            }
          }
        }
        throw busy();
      }
    }
    try {
      const origin = async () => ({ value: await load(), written: Date.now() });
      // Vercel Data Cache remains a shared fallback when Redis has not been provisioned or is down.
      const read = redisAvailable
        ? origin
        : unstable_cache(origin, ["public-fallback-v1", key], {
            revalidate: policy.fresh,
          });
      let value = await read();
      // Next's stale revalidation must not make arbitrarily old prices appear current.
      if (!valid(value, policy.fresh + policy.stale)) value = await origin();
      if (redisAvailable && locked) {
        const serialized = JSON.stringify(value);
        if (Buffer.byteLength(serialized) <= MAX_ENTRY) {
          // Only the current owner may publish. An expired loader cannot overwrite a newer refresh.
          await redisCommand([
            "EVAL",
            "if redis.call('GET',KEYS[2]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1 end; return 0",
            2,
            key,
            lockKey,
            owner,
            serialized,
            policy.fresh + policy.stale,
          ]).catch(() => {});
        }
      }
      remember(key, value);
      return value;
    } catch (error) {
      if (valid(entry, policy.fresh + policy.stale)) return entry!;
      throw error;
    } finally {
      if (locked)
        await redisCommand([
          "EVAL",
          "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
          1,
          lockKey,
          owner,
        ]).catch(() => {});
    }
  })().finally(() => pending.delete(key));
  pending.set(key, work);
  if (valid(entry, policy.fresh + policy.stale)) {
    after(async () => {
      await work.catch(() => {});
    });
    return entry!.value;
  }
  return (await work).value;
}
