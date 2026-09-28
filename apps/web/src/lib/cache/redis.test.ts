import { afterEach, expect, it, vi } from "vitest";
import { redisKey } from "./redis";
afterEach(() => vi.unstubAllEnvs());
it("isolates staging cache keys even if it shares Redis and Vercel identifiers", () => {
  vi.stubEnv("VERCEL_PROJECT_ID", "same-project");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  const prod = redisKey("public-v1", "tokens");
  expect(prod).toContain(":production:mainnet-beta:");
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  vi.stubEnv("STAGING_MAINNET_ENABLED", "true");
  const staging = redisKey("public-v1", "tokens");
  expect(staging).toContain(":production:staging-mainnet-beta:");
  expect(staging).not.toBe(prod);
  vi.stubEnv("SOLANA_NETWORK", "devnet");
  expect(redisKey("public-v1", "tokens")).not.toBe(staging);
  expect(redisKey("public-v1", "tokens")).toContain("staging-devnet");
});
it("fails closed before sharing a cache on staging-mainnet without opt-in", () => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  vi.stubEnv("STAGING_MAINNET_ENABLED", "false");
  expect(() => redisKey("public-v1", "tokens")).toThrow(
    "STAGING_MAINNET_ENABLED",
  );
});
