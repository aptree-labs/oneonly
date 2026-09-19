import { describe, it, expect } from "vitest";
import { Effect, Either } from "effect";
import {
  normalizeTicker,
  parseUnits,
  canReleaseTicker,
  DAY,
  validateLaunch,
} from "./launchpad";
describe("launchpad rules", () => {
  const launch = {
    ticker: "TEST",
    name: "Test token",
    description: "A token without a creator purchase",
    imageId: "00000000-0000-4000-8000-000000000001",
    quote: "SOL",
    slippageBps: 100,
  };
  it("allows a one-character name while rejecting empty and oversized names", async () => {
    expect(
      (await Effect.runPromise(validateLaunch({ ...launch, name: "1" }))).name,
    ).toBe("1");
    for (const name of [" ", "a".repeat(33)]) {
      expect(
        Either.isLeft(
          await Effect.runPromise(
            Effect.either(validateLaunch({ ...launch, name })),
          ),
        ),
      ).toBe(true);
    }
  });
  it("allows omitted, blank and zero first buys, preserving positive buys", async () => {
    for (const initialBuy of [undefined, "", " ", "0", "0,00", "0.000000"]) {
      expect(
        (await Effect.runPromise(validateLaunch({ ...launch, initialBuy })))
          .initialBuy,
      ).toBe("0");
    }
    expect(
      (
        await Effect.runPromise(
          validateLaunch({ ...launch, initialBuy: "0,05" }),
        )
      ).initialBuy,
    ).toBe("0.05");
  });
  it("does not treat malformed or negative first buys as an opt-out", async () => {
    for (const initialBuy of ["-1", "NaN", "1e2", "0.1.2", "0.0000000001"]) {
      expect(
        Either.isLeft(
          await Effect.runPromise(
            Effect.either(validateLaunch({ ...launch, initialBuy })),
          ),
        ),
      ).toBe(true);
    }
  });
  it("canonicalizes ASCII tickers and rejects Unicode before case folding", () => {
    expect(normalizeTicker(" $ so l ")).toBe("SOL");
    for (const value of ["ſOL", "ß", "ЅOL", "💥", "a-b", ""]) {
      expect(() => normalizeTicker(value)).toThrow();
    }
  });
  it("converts exact amounts without floating-point rounding", () => {
    expect(parseUnits("123456789.123456789", 9)).toBe(123456789123456789n);
    for (const value of [
      "1e3",
      "-1",
      "0",
      "0.0000000001",
      "18446744073709551616",
    ]) {
      expect(() => parseUnits(value, 9)).toThrow();
    }
  });
  const now = new Date("2026-09-11T15:00:00Z");
  const covered = {
    createdAt: new Date("2026-09-01Z"),
    coverageStart: new Date("2026-09-01Z"),
    indexedThrough: new Date("2026-09-11Z"),
    hasUnknownVolume: false,
    dailyVolumes: [
      { day: "2026-09-08", usd: 99 },
      { day: "2026-09-09", usd: 0 },
      { day: "2026-09-10", usd: 99.99 },
    ],
  };
  it("releases only below $100 on each of three complete UTC days", () => {
    expect(canReleaseTicker([covered], now)).toBe(true);
    expect(
      canReleaseTicker(
        [{ ...covered, dailyVolumes: [{ day: "2026-09-09", usd: 100 }] }],
        now,
      ),
    ).toBe(false);
  });
  it("requires every pool and complete verifiable history", () => {
    for (const broken of [
      { hasUnknownVolume: true },
      { indexedThrough: null },
      { coverageStart: null },
      { createdAt: new Date(now.getTime() - 2 * DAY) },
      { dailyVolumes: [{ day: "2026-09-09", usd: null }] },
    ])
      expect(canReleaseTicker([covered, { ...covered, ...broken }], now)).toBe(
        false,
      );
    expect(canReleaseTicker([], now)).toBe(false);
  });
  it("does not count an unfinished UTC day toward the three-day period", () => {
    expect(
      canReleaseTicker(
        [{ ...covered, indexedThrough: new Date("2026-09-10T23:59:59Z") }],
        now,
      ),
    ).toBe(false);
  });
});
