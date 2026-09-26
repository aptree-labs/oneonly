import { describe, expect, it } from "vitest";
import {
  assertStagingEnvironment,
  xLinkStartOrigin,
  xLinkReturnOrigin,
} from "./deployment";

const staging = {
  ONEONLY_ENVIRONMENT: "staging",
  SOLANA_NETWORK: "devnet",
  APP_URL: "https://staging.oneonly.lol",
  LAUNCHPAD_URL: "https://staging.oneonly.lol",
  DATABASE_URL: "postgres://user:password@staging.invalid/oneonly_staging",
};

describe("staging isolation", () => {
  it("accepts devnet and rejects mainnet or an implicit network", () => {
    expect(() => assertStagingEnvironment(staging)).not.toThrow();
    for (const SOLANA_NETWORK of ["mainnet-beta", undefined])
      expect(() =>
        assertStagingEnvironment({ ...staging, SOLANA_NETWORK }),
      ).toThrow("devnet");
  });

  it("rejects OAuth callbacks or wallet origins on production", () => {
    for (const key of ["APP_URL", "LAUNCHPAD_URL"])
      expect(() =>
        assertStagingEnvironment({ ...staging, [key]: "https://oneonly.lol" }),
      ).toThrow("staging.oneonly.lol");
  });

  it("rejects a production database and inherited mainnet credentials", () => {
    expect(() =>
      assertStagingEnvironment({
        ...staging,
        DATABASE_URL: "postgres://user:password@db.invalid/oneonly_mainnet",
      }),
    ).toThrow("database");
    expect(() =>
      assertStagingEnvironment({
        ...staging,
        MAINNET_DATABASE_URL:
          "postgres://user:password@db.invalid/oneonly_mainnet",
      }),
    ).toThrow("database");
  });

  it("keeps both ends of staging X linking off the production broker", () => {
    expect(xLinkStartOrigin(staging)).toBe(staging.APP_URL);
    expect(xLinkReturnOrigin(staging)).toBe(staging.APP_URL);
    expect(xLinkStartOrigin({})).toBe("https://oneonly.lol");
    expect(xLinkReturnOrigin({})).toBe("https://app.oneonly.lol");
    expect(() =>
      assertStagingEnvironment({ SOLANA_NETWORK: "mainnet-beta" }),
    ).not.toThrow();
  });
});
