import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { validateLaunch } from "./launchpad";
import {
  isOfficialPlatformToken,
  isReservedPlatformTicker,
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
  ])("reserves %s", (ticker) => {
    expect(isReservedPlatformTicker(ticker)).toBe(true);
  });
  it.each(["ONE", "ONLY", "GIDDY", "SOL", "ONETWO", "HOMER", "JUP"])(
    "does not reserve unrelated ticker %s",
    (ticker) => {
      expect(isReservedPlatformTicker(ticker)).toBe(false);
    },
  );
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
  it.each(["ONEONLY", "1ONLY", "10NLY"])(
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
