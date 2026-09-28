import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { validateLaunch } from "./launchpad";
import {
  isOfficialPlatformToken,
  isReservedPlatformTicker,
  isReservedLaunchTicker,
  PLATFORM_TOKEN_MINT,
} from "./platform-token";

describe("official platform identity", () => {
  it.each([
    "ONEONLY",
    "1only",
    "10nly",
    "$ one only",
    "0NE0NLY",
    "ONEON1Y",
    "ON3ONLY",
    "ONEONLY2",
    "XONEONLY",
    "ONEONL",
    "ONEONLLY",
    "ONEONLX",
    "ONLYONE",
    "$ only one",
    "0NLY0N3",
    "ON1YONE",
    "ONLY1",
    "0nly1",
    "ONLYONE2",
    "XONLYONE",
    "ONLYON",
    "ONLYONNE",
    "ONLYONX",
  ])("reserves %s", (ticker) => {
    expect(isReservedPlatformTicker(ticker)).toBe(true);
  });
  it.each([
    "ONE",
    "ONLY",
    "GIDDY",
    "SOL",
    "ONETWO",
    "HOMER",
    "JUP",
    "ONLYLOVE",
  ])("does not reserve unrelated ticker %s", (ticker) => {
    expect(isReservedPlatformTicker(ticker)).toBe(false);
  });
  it("binds gold verification to the exact mainnet mint, never a name", () => {
    expect(isOfficialPlatformToken(PLATFORM_TOKEN_MINT, "mainnet-beta")).toBe(
      true,
    );
    expect(isOfficialPlatformToken(PLATFORM_TOKEN_MINT, "devnet")).toBe(false);
    expect(isOfficialPlatformToken("ONEONLY", "mainnet-beta")).toBe(false);
    expect(
      isOfficialPlatformToken(
        PLATFORM_TOKEN_MINT.toLowerCase(),
        "mainnet-beta",
      ),
    ).toBe(false);
  });
  it.each([
    "ONEONLY",
    "1ONLY",
    "10NLY",
    "ONLYONE",
    "ONLY1",
    "0NLY0NE",
    "ONLYONE2",
  ])(
    "rejects a server-side launch for %s even without a ticker claim",
    async (ticker) => {
      await expect(
        Effect.runPromise(
          validateLaunch({
            ticker,
            name: "Imitation",
            imageId: "00000000-0000-4000-8000-000000000001",
            quote: "JUP",
            slippageBps: 100,
          }),
        ),
      ).rejects.toThrow(/reserved/);
    },
  );
});

describe("moderated launch tickers", () => {
  it.each([
    "X",
    "x",
    "$x",
    "Phantom",
    "PHANTOM",
    "ONEPHANTOM",
    "friendzy",
    " Friendzy ",
    "PHAN_TOM",
    "FRIEND-ZY",
  ])("reserves %s", (ticker) => {
    expect(isReservedLaunchTicker(ticker)).toBe(true);
  });
  it.each(["XX", "XRP", "SPYX", "FOX", "FRIEND", "PHANTOM2"])(
    "does not reserve unrelated %s",
    (ticker) => {
      expect(isReservedLaunchTicker(ticker)).toBe(false);
    },
  );
  it.each(["X", "Phantom", "ONEPHANTOM", "friendzy"])(
    "rejects %s server-side before launch",
    async (ticker) => {
      await expect(
        Effect.runPromise(
          validateLaunch({
            ticker,
            name: "Token",
            imageId: "00000000-0000-4000-8000-000000000001",
            quote: "SOL",
            slippageBps: 100,
          }),
        ),
      ).rejects.toThrow(/reserved/);
    },
  );
});
