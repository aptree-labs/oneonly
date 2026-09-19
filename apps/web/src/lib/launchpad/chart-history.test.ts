import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@oneonly/db", () => ({ marketCandles: read }));
import { chartHistory } from "./chart-history";
const empty = {
  candles: [],
  hasMore: false,
  from: null,
  through: "2026-09-19",
};
const quoted = {
  ...empty,
  candles: [{ time: 1, close: "0.000014", volume: "2" }],
};
beforeEach(() => read.mockReset());
it("falls back to the actual pair prices when USD history is unavailable", async () => {
  read.mockResolvedValueOnce(empty).mockResolvedValueOnce(quoted);
  const result = await chartHistory(
    {} as never,
    "jup-token",
    "15m",
    undefined,
    "usd",
    true,
  );
  expect(result).toMatchObject({
    ...quoted,
    currency: "quote",
    fallback: true,
  });
  expect(read.mock.calls[1].at(-1)).toBe("quote");
});
it("keeps available USD history and respects an explicit pair selection", async () => {
  read.mockResolvedValue(quoted);
  expect(
    await chartHistory({} as never, "token", "15m", undefined, "usd", true),
  ).toMatchObject({ currency: "usd", fallback: false });
  expect(read).toHaveBeenCalledOnce();
  expect(
    await chartHistory({} as never, "token", "1m", 100, "quote", true),
  ).toMatchObject({ currency: "quote", fallback: false });
  expect(read).toHaveBeenCalledTimes(2);
});
it("does not invent a price point for an unindexed or untraded pool", async () => {
  read.mockResolvedValue({ ...empty, through: null });
  expect(
    await chartHistory({} as never, "token", "15m", undefined, "usd", true),
  ).toMatchObject({ candles: [], through: null, fallback: false });
});
