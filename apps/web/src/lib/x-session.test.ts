import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
  }),
}));
import {
  hasXSessionProof,
  signXSession,
  verifyXSession,
  walletSessionCookie,
  X_SESSION_COOKIE,
} from "./x-session";
const identity = {
  wallet: "wallet-A",
  xId: "123",
  verifiedAt: Date.parse("2026-09-27T12:00:00Z"),
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(identity.verifiedAt);
  vi.stubEnv("X_LINK_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("SOLANA_NETWORK", "devnet");
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  vi.stubEnv("LAUNCHPAD_URL", "https://staging.oneonly.lol");
  jar.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("reuses OAuth beyond ten minutes only in the same signed wallet session", async () => {
  const proof = signXSession(identity, "session-A");
  vi.setSystemTime(identity.verifiedAt + 3600_000);
  jar.set(X_SESSION_COOKIE, proof);
  jar.set(walletSessionCookie(), "session-A");
  expect(await hasXSessionProof(identity)).toBe(true);
  jar.set(walletSessionCookie(), "session-B");
  expect(await hasXSessionProof(identity)).toBe(false);
  jar.delete(walletSessionCookie());
  expect(await hasXSessionProof(identity)).toBe(false);
});
it("rejects altered, expired, future, wrong-wallet, changed-profile and cross-environment proofs", () => {
  const proof = signXSession(identity, "session-A");
  expect(
    verifyXSession(proof, { ...identity, wallet: "wallet-B" }, "session-A"),
  ).toBe(false);
  expect(verifyXSession(proof, { ...identity, xId: "456" }, "session-A")).toBe(
    false,
  );
  expect(
    verifyXSession(
      proof,
      { ...identity, verifiedAt: identity.verifiedAt + 1 },
      "session-A",
    ),
  ).toBe(false);
  for (const value of [
    "",
    "garbage",
    proof + ".extra",
    "x" + proof,
    proof.split(".")[0] + ".bad",
  ])
    expect(verifyXSession(value, identity, "session-A")).toBe(false);
  vi.setSystemTime(identity.verifiedAt - 1);
  expect(verifyXSession(proof, identity, "session-A")).toBe(false);
  vi.setSystemTime(identity.verifiedAt + 86400_000);
  expect(verifyXSession(proof, identity, "session-A")).toBe(false);
  vi.setSystemTime(identity.verifiedAt);
  vi.stubEnv("LAUNCHPAD_URL", "https://oneonly.lol");
  expect(verifyXSession(proof, identity, "session-A")).toBe(false);
  vi.stubEnv("LAUNCHPAD_URL", "https://staging.oneonly.lol");
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  expect(verifyXSession(proof, identity, "session-A")).toBe(false);
});
it("rejects proof after signing-key rotation", () => {
  const proof = signXSession(identity, "session-A");
  vi.stubEnv("X_LINK_SECRET", randomBytes(32).toString("hex"));
  expect(verifyXSession(proof, identity, "session-A")).toBe(false);
});

it("isolates staging-mainnet wallet and X sessions even with identical network/secret/origin", () => {
  vi.stubEnv("SOLANA_NETWORK", "mainnet-beta");
  vi.stubEnv("STAGING_MAINNET_ENABLED", "true");
  const stagingCookie = walletSessionCookie();
  expect(stagingCookie).toBe("oneonly-wallet-staging-mainnet-beta");
  const proof = signXSession(identity, "same-session");
  expect(verifyXSession(proof, identity, "same-session")).toBe(true);
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  expect(walletSessionCookie()).toBe("oneonly-wallet-mainnet-beta");
  expect(verifyXSession(proof, identity, "same-session")).toBe(false);
  const productionProof = signXSession(identity, "same-session");
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  expect(verifyXSession(productionProof, identity, "same-session")).toBe(false);
  vi.stubEnv("STAGING_MAINNET_ENABLED", "false");
  expect(verifyXSession(proof, identity, "same-session")).toBe(false);
  expect(() => walletSessionCookie()).toThrow("STAGING_MAINNET_ENABLED");
});
