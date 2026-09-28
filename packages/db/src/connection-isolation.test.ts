import { afterEach, expect, it, vi } from "vitest";
vi.mock("postgres", () => ({ default: (url: string) => ({ url }) }));
vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: (client: { url: string }) => ({ testUrl: client.url }),
}));
import { getDatabase } from "./index";
afterEach(() => vi.unstubAllEnvs());
it("cannot return a cached production client after switching to staging mainnet", async () => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  vi.stubEnv(
    "MAINNET_DATABASE_URL",
    "postgres://user@isolated-test.invalid/oneonly_mainnet",
  );
  const prod = await getDatabase();
  expect(await getDatabase()).toBe(prod);
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  vi.stubEnv("STAGING_MAINNET_ENABLED", "true");
  vi.stubEnv("MAINNET_DATABASE_URL", "");
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://user@isolated-test.invalid/oneonly_staging_mainnet",
  );
  const staging = await getDatabase();
  expect(staging).not.toBe(prod);
  expect(staging).toEqual({
    testUrl: "postgres://user@isolated-test.invalid/oneonly_staging_mainnet",
  });
  expect(await getDatabase()).toBe(staging);
  vi.stubEnv("STAGING_MAINNET_ENABLED", "false");
  expect(() => getDatabase()).toThrow("isolated");
  vi.stubEnv("STAGING_MAINNET_ENABLED", "true");
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://user@isolated-test.invalid/oneonly_mainnet",
  );
  expect(() => getDatabase()).toThrow("isolated");
});
