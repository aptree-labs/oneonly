import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  redis: vi.fn(),
  configured: vi.fn(),
  after: vi.fn(),
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: Function) => fn }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./redis", () => ({
  redisConfigured: mocks.configured,
  redisCommand: mocks.redis,
  redisKey: (_: string, key: string) => key,
}));
const policy = { fresh: 5, stale: 10 };
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.configured.mockReturnValue(false);
});
it("coalesces a 1,000-request burst and reuses the resulting value", async () => {
  const { publicCache } = await import("./public-cache");
  const load = vi.fn(async () => ({ price: 7 }));
  const values = await Promise.all(
    Array.from({ length: 1000 }, () => publicCache("popular", policy, load)),
  );
  expect(load).toHaveBeenCalledOnce();
  expect(values.every((v) => v.price === 7)).toBe(true);
  await publicCache("popular", policy, load);
  expect(load).toHaveBeenCalledOnce();
});
it("serves bounded stale data during an outage, never indefinitely", async () => {
  const { publicCache } = await import("./public-cache");
  vi.useFakeTimers();
  const load = vi
    .fn()
    .mockResolvedValueOnce({ price: 7 })
    .mockRejectedValue(new Error("origin unavailable"));
  await publicCache("outage", policy, load);
  await vi.advanceTimersByTimeAsync(6000);
  expect(await publicCache("outage", policy, load)).toEqual({ price: 7 });
  await mocks.after.mock.calls[0][0]();
  await vi.advanceTimersByTimeAsync(10000);
  await expect(publicCache("outage", policy, load)).rejects.toThrow(
    "origin unavailable",
  );
  vi.useRealTimers();
});
it("shares cached responses across independent server instances", async () => {
  mocks.configured.mockReturnValue(true);
  const data = new Map<string, string>();
  mocks.redis.mockImplementation(async (command: (string | number)[]) => {
    const [op, key] = command;
    if (op === "GET") return data.get(String(key)) ?? null;
    if (op === "SET") {
      data.set(String(key), String(command[2]));
      return "OK";
    }
    if (op === "EVAL" && command[2] === 2) {
      data.set(String(command[3]), String(command[6]));
      return 1;
    }
    return 1;
  });
  const load = vi.fn(async () => ({ price: 12 }));
  await (await import("./public-cache")).publicCache("shared", policy, load);
  vi.resetModules();
  expect(
    await (await import("./public-cache")).publicCache("shared", policy, load),
  ).toEqual({ price: 12 });
  expect(load).toHaveBeenCalledOnce();
});
it("does not run a duplicate origin loader while another server owns the cold lock", async () => {
  mocks.configured.mockReturnValue(true);
  mocks.redis.mockResolvedValue(null);
  const { publicCache } = await import("./public-cache");
  const load = vi.fn();
  await expect(publicCache("locked", policy, load)).rejects.toMatchObject({
    status: 503,
  });
  expect(load).not.toHaveBeenCalled();
});
it("falls back when Redis is unavailable and does not cache origin failures", async () => {
  mocks.configured.mockReturnValue(true);
  mocks.redis.mockRejectedValue(new Error("Redis timeout"));
  const { publicCache } = await import("./public-cache");
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("origin failed"))
    .mockResolvedValue({ price: 9 });
  await expect(publicCache("retry", policy, load)).rejects.toThrow(
    "origin failed",
  );
  expect(await publicCache("retry", policy, load)).toEqual({ price: 9 });
});
it("caps simultaneous distinct origin loads to protect dependencies", async () => {
  const { publicCache } = await import("./public-cache");
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const pending = Array.from({ length: 32 }, (_, i) =>
    publicCache(String(i), policy, async () => {
      await gate;
      return i;
    }),
  );
  await expect(
    publicCache("overflow", policy, async () => 33),
  ).rejects.toMatchObject({ status: 503 });
  release();
  await Promise.all(pending);
});
