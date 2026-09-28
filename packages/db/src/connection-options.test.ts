import { expect, it } from "vitest";
import {
  assertStagingDatabase,
  runtimeDatabaseUrl,
  selectedDatabaseUrl,
} from "./connection-options";

it("refuses mainnet or a missing database at staging runtime", () => {
  const env = {
    ONEONLY_ENVIRONMENT: "staging",
    SOLANA_NETWORK: "devnet",
    DATABASE_URL: "postgres://user@staging.invalid/oneonly_staging",
  };
  expect(() => assertStagingDatabase(env)).not.toThrow();
  for (const override of [
    { SOLANA_NETWORK: "mainnet-beta" },
    { DATABASE_URL: undefined },
    { DATABASE_URL: "postgres://user@production.invalid/oneonly_mainnet" },
    {
      MAINNET_DATABASE_URL:
        "postgres://user@production.invalid/oneonly_mainnet",
    },
  ])
    expect(() => assertStagingDatabase({ ...env, ...override })).toThrow(
      "isolated",
    );
  expect(() =>
    assertStagingDatabase({ SOLANA_NETWORK: "mainnet-beta" }),
  ).not.toThrow();
});
it("uses Neon pooling without changing the isolated database, TLS or credentials", () => {
  const url = new URL(
    runtimeDatabaseUrl(
      "postgres://user:password@ep-example.us-east-1.aws.neon.tech/oneonly_mainnet?sslmode=require",
    ),
  );
  expect(url.hostname).toBe("ep-example-pooler.us-east-1.aws.neon.tech");
  expect(url.pathname).toBe("/oneonly_mainnet");
  expect(url.username).toBe("user");
  expect(url.password).toBe("password");
  expect(url.searchParams.get("sslmode")).toBe("require");
});
it("preserves existing poolers and non-Neon servers", () => {
  for (const value of [
    "postgres://user@ep-example-pooler.us-east-1.aws.neon.tech/db",
    "postgres://user@localhost:5432/db",
    "postgres://user@notneon.tech/db",
  ])
    expect(runtimeDatabaseUrl(value)).toBe(value);
});

it("selects only the dedicated staging-mainnet database under explicit opt-in", () => {
  const env = {
    ONEONLY_ENVIRONMENT: "staging",
    SOLANA_NETWORK: "mainnet-beta",
    STAGING_MAINNET_ENABLED: "true",
    DATABASE_URL: "postgres://user@db.invalid/oneonly_staging_mainnet",
  };
  expect(selectedDatabaseUrl(env)).toBe(env.DATABASE_URL);
  for (const override of [
    { STAGING_MAINNET_ENABLED: undefined },
    { STAGING_MAINNET_ENABLED: "false" },
    { DATABASE_URL: undefined },
    { DATABASE_URL: "postgres://user@db.invalid/oneonly_mainnet" },
    { DATABASE_URL: "postgres://user@db.invalid/oneonly_staging" },
    { DATABASE_URL: "postgres://user@db.invalid/oneonly_%6dainnet" },
    { DATABASE_URL: "https://db.invalid/oneonly_staging_mainnet" },
    {
      DATABASE_URL:
        "postgres://user@db.invalid/oneonly_staging_mainnet?database=oneonly_mainnet",
    },
    {
      DATABASE_URL:
        "postgres://user@db.invalid/oneonly_staging_mainnet?dbname=oneonly_mainnet",
    },
    { MAINNET_DATABASE_URL: "postgres://user@db.invalid/oneonly_mainnet" },
  ])
    expect(() => selectedDatabaseUrl({ ...env, ...override })).toThrow(
      "isolated",
    );
  expect(() =>
    selectedDatabaseUrl({ ...env, SOLANA_NETWORK: "devnet" }),
  ).toThrow("isolated");
});
it("preserves production mainnet selection and requires its existing database", () => {
  const prod = "postgres://user@db.invalid/oneonly_mainnet";
  expect(
    selectedDatabaseUrl({
      SOLANA_NETWORK: "mainnet-beta",
      MAINNET_DATABASE_URL: prod,
      DATABASE_URL: "postgres://user@db.invalid/other",
    }),
  ).toBe(prod);
  expect(() =>
    selectedDatabaseUrl({ SOLANA_NETWORK: "mainnet-beta", DATABASE_URL: prod }),
  ).toThrow("Mainnet requires");
  expect(
    selectedDatabaseUrl({
      SOLANA_NETWORK: "devnet",
      DATABASE_URL: "postgres://user@db.invalid/dev",
    }),
  ).toContain("/dev");
});
