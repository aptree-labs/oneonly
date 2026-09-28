import { afterEach, beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ runtime: vi.fn() }));
vi.mock("./runtime", () => ({ creatorFeeRuntime: calls.runtime }));
vi.mock("./balances", () => ({ readCreatorFeeBalances: vi.fn() }));
vi.mock("./projections", () => ({
  cachedFeeBalances: vi.fn(),
  recipientFeeTotals: vi.fn(),
}));
vi.mock("@oneonly/protocol", () => ({
  client: vi.fn(),
  PublicKey: class {},
  get NETWORK() {
    return process.env.SOLANA_NETWORK ?? "devnet";
  },
}));
vi.mock("next/cache", () => ({
  unstable_cache: (load: () => unknown) => load,
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../cache/redis", () => ({
  redisConfigured: () => false,
  redisCommand: vi.fn(),
  redisKey: (_purpose: string, key: string) => key,
}));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  calls.runtime.mockReset().mockResolvedValue({});
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  vi.stubEnv("SOLANA_NETWORK", "devnet");
  vi.stubEnv("CREATOR_FEES_ENABLED", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("coalesces public readiness bursts, expires after five seconds and fails closed", async () => {
  const { feeStatus } = await import("./service");
  const results = await Promise.all(
    Array.from({ length: 100 }, () => feeStatus()),
  );
  expect(results.every((r) => r.escrowAvailable)).toBe(true);
  expect(calls.runtime).toHaveBeenCalledTimes(1);
  calls.runtime.mockRejectedValue(new Error("chain unavailable"));
  vi.advanceTimersByTime(5001);
  expect((await feeStatus()).escrowAvailable).toBe(false);
  expect(calls.runtime).toHaveBeenCalledTimes(2);
  expect((await feeStatus()).escrowAvailable).toBe(false);
  expect(calls.runtime).toHaveBeenCalledTimes(2);
});
it("never returns cached readiness after feature disablement or on mainnet", async () => {
  const { feeStatus } = await import("./service");
  expect((await feeStatus()).escrowAvailable).toBe(true);
  vi.stubEnv("CREATOR_FEES_ENABLED", "false");
  expect((await feeStatus()).escrowAvailable).toBe(false);
  vi.stubEnv("CREATOR_FEES_ENABLED", "true");
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  expect(await feeStatus()).toMatchObject({
    enabled: false,
    escrowAvailable: false,
  });
  expect(calls.runtime).toHaveBeenCalledTimes(1);
});
it("separates cached readiness across networks and keeps production disabled", async () => {
  const { feeStatus } = await import("./service");
  expect((await feeStatus()).network).toBe("devnet");
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  vi.stubEnv("STAGING_MAINNET_ENABLED", "true");
  expect(await feeStatus()).toMatchObject({
    network: "mainnet-beta",
    enabled: true,
    escrowAvailable: true,
  });
  expect(calls.runtime).toHaveBeenCalledTimes(2);
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  expect(await feeStatus()).toMatchObject({
    enabled: false,
    escrowAvailable: false,
  });
});
