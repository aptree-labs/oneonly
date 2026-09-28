import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyInternalTestProof } from "./test-proof";
const code = `OO-TEST-${"a".repeat(32)}`;
const scope = {
  network: "mainnet-beta",
  wallet: "owner",
  xId: "123",
  bindingVersion: 1,
  tokenId: "token",
  mint: "SOL",
};
const now = new Date("2026-09-28T15:00:00Z");
const grant = {
  ...scope,
  hash: createHash("sha256").update(code).digest("hex"),
  expiresAt: "2026-09-28T16:00:00Z",
};
beforeEach(() => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  vi.stubEnv("CREATOR_FEE_TEST_GRANT", JSON.stringify(grant));
});
afterEach(() => vi.unstubAllEnvs());
it("accepts only the operator's scoped code and produces stable single-use evidence", () => {
  expect(verifyInternalTestProof(code, scope, now)?.tweetId).toBe(
    `internal-test:${grant.hash}`,
  );
  expect(
    verifyInternalTestProof("https://x.com/u/status/1", scope, now),
  ).toBeNull();
});
it.each([
  "network",
  "wallet",
  "xId",
  "tokenId",
  "mint",
  "bindingVersion",
] as const)("rejects changed %s", (key) => {
  expect(() =>
    verifyInternalTestProof(
      code,
      { ...scope, [key]: key === "bindingVersion" ? 2 : "other" },
      now,
    ),
  ).toThrow();
});
it("fails closed for production, missing/malformed grants, wrong codes and expiration", () => {
  expect(() =>
    verifyInternalTestProof(`OO-TEST-${"b".repeat(32)}`, scope, now),
  ).toThrow();
  expect(() =>
    verifyInternalTestProof(code, scope, new Date(grant.expiresAt)),
  ).toThrow();
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  expect(() => verifyInternalTestProof(code, scope, now)).toThrow();
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  for (const value of [
    "",
    "null",
    "bad",
    "{}",
    JSON.stringify({ ...grant, expiresAt: "invalid" }),
  ]) {
    vi.stubEnv("CREATOR_FEE_TEST_GRANT", value);
    expect(() => verifyInternalTestProof(code, scope, now)).toThrow();
  }
});
