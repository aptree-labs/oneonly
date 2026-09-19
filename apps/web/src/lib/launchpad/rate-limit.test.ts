import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  command: vi.fn(),
  db: vi.fn(),
}));
vi.mock("../cache/redis", () => ({
  redisRateLimitsEnabled: mocks.enabled,
  redisCommand: mocks.command,
  redisKey: (_: string, key: string) => key,
}));
vi.mock("@oneonly/db", () => ({
  getDatabase: mocks.db,
  walletChallenges: {},
  walletSessions: {},
  apiLimits: {},
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
  sql: vi.fn(),
}));
import { rateLimit } from "./auth";
afterEach(() => vi.clearAllMocks());
it("does not use the optional Redis limiter on the free-plan default", async () => {
  mocks.enabled.mockReturnValue(false);
  const returning = vi.fn(async () => [{ count: 1 }]);
  mocks.db.mockResolvedValue({
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => ({ returning }) }),
    }),
  });
  await rateLimit("existing-db", 3);
  expect(returning).toHaveBeenCalledOnce();
  expect(mocks.command).not.toHaveBeenCalled();
});
it("enforces the shared count and caches only denials", async () => {
  mocks.enabled.mockReturnValue(true);
  mocks.command.mockResolvedValue([4, 40000]);
  await expect(rateLimit("blocked-test", 3)).rejects.toMatchObject({
    status: 429,
  });
  await expect(rateLimit("blocked-test", 3)).rejects.toMatchObject({
    status: 429,
  });
  expect(mocks.command).toHaveBeenCalledOnce();
  expect(mocks.db).not.toHaveBeenCalled();
});
it("never silently permits sensitive operations when an enabled Redis limiter fails", async () => {
  mocks.enabled.mockReturnValue(true);
  mocks.command.mockRejectedValue(new Error("timeout"));
  await expect(rateLimit("down-test", 3)).rejects.toMatchObject({
    status: 503,
  });
  expect(mocks.db).not.toHaveBeenCalled();
});
