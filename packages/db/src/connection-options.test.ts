import { expect, it } from "vitest";
import {
  assertStagingDatabase,
  runtimeDatabaseUrl,
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
