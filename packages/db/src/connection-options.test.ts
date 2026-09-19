import { expect, it } from "vitest";
import { runtimeDatabaseUrl } from "./connection-options";
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
