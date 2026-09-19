import { it, expect, afterEach, vi } from "vitest";
import { signXLink, readXLink, safeXAvatar } from "./x-link";
import { randomBytes } from "node:crypto";
afterEach(() => vi.unstubAllEnvs());
it("binds an expiring X link to its wallet, browser nonce, purpose and token", () => {
  vi.stubEnv("X_LINK_SECRET", randomBytes(32).toString("hex"));
  const value = {
    purpose: "request" as const,
    nonce: randomBytes(32).toString("base64url"),
    wallet: "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR",
    tokenId: "e3cecf42-93f0-420e-a94f-8d4c94840adf",
    expires: Date.now() + 60_000,
  };
  expect(
    readXLink(signXLink({ ...value, tokenId: "" }), "request").tokenId,
  ).toBe("");
  for (const tokenId of ["../../other", "https://evil.test", "-".repeat(36)])
    expect(() =>
      readXLink(signXLink({ ...value, tokenId }), "request"),
    ).toThrow();
  const signed = signXLink(value);
  expect(readXLink(signed, "request")).toEqual(value);
  expect(() => readXLink(signed, "profile")).toThrow();
  const [payload, signature] = signed.split(".");
  expect(() =>
    readXLink(
      Buffer.from(JSON.stringify({ ...value, wallet: "attacker" })).toString(
        "base64url",
      ) +
        "." +
        signature,
      "request",
    ),
  ).toThrow();
  expect(() =>
    readXLink(signXLink({ ...value, expires: Date.now() - 1 }), "request"),
  ).toThrow();
  expect(() =>
    readXLink(
      signXLink({
        ...value,
        purpose: "profile",
        xId: "123",
        username: "../other",
      }),
      "profile",
    ),
  ).toThrow();
  expect(
    readXLink(
      signXLink({
        ...value,
        purpose: "profile",
        xId: "123",
        username: "verified_user",
      }),
      "profile",
    ).username,
  ).toBe("verified_user");
});
it("only renders X-hosted profile images", () => {
  expect(
    safeXAvatar("https://pbs.twimg.com/profile_images/123/photo.jpg"),
  ).not.toBeNull();
  for (const value of [
    "https://evil.test/photo.jpg",
    "http://pbs.twimg.com/profile_images/1/x",
    "https://pbs.twimg.com.evil.test/profile_images/x",
    "javascript:alert(1)",
    null,
  ])
    expect(safeXAvatar(value)).toBeNull();
});
