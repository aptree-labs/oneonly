import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { walletSessionCookie } from "@/lib/x-session";
import { signXLink, type XLink } from "@/lib/x-link";
const calls = vi.hoisted(() => ({
  wallet: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  db: vi.fn(),
}));
vi.mock("@oneonly/db", () => ({
  getDatabase: calls.db,
  walletProfiles: { wallet: "wallet" },
}));
vi.mock("@/lib/launchpad/auth", () => ({
  session: calls.wallet,
  origin: () => "https://staging.oneonly.lol",
}));
import { GET } from "./route";
const wallet = "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR";
let proof: XLink;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("X_LINK_SECRET", randomBytes(32).toString("hex"));
  calls.wallet.mockResolvedValue(wallet);
  calls.db.mockResolvedValue({ insert: () => ({ values: calls.values }) });
  calls.values.mockReturnValue({ onConflictDoUpdate: calls.update });
  calls.update.mockResolvedValue(undefined);
  proof = {
    purpose: "profile",
    wallet,
    nonce: randomBytes(32).toString("base64url"),
    tokenId: "",
    xId: "123",
    username: "verified_user",
    expires: Date.now() + 60_000,
  };
});
afterEach(() => vi.unstubAllEnvs());
const callback = (value: XLink, extra = "") =>
  new NextRequest(
    `https://staging.oneonly.lol/api/launchpad/x-callback?profile=${encodeURIComponent(signXLink(value))}${extra}`,
    {
      headers: {
        cookie: `oneonly-x-link=${value.nonce}; ${walletSessionCookie()}=test-wallet-session`,
      },
    },
  );
it("returns to the signed fee dashboard only after wallet-bound OAuth verification", async () => {
  const result = await GET(
    callback({ ...proof, returnTo: "/app/creator-fees" }),
  );
  expect(result.headers.get("location")).toBe(
    "https://staging.oneonly.lol/app/creator-fees?x=linked",
  );
  expect(calls.values).toHaveBeenCalledWith(
    expect.objectContaining({ wallet, xId: "123" }),
  );
  expect(calls.update).toHaveBeenCalledWith(
    expect.objectContaining({
      set: expect.objectContaining({ linkedAt: expect.any(Date) }),
    }),
  );
  expect(result.headers.get("cache-control")).toBe("no-store");
});
it("preserves existing app/token destinations and ignores unsigned return overrides", async () => {
  expect(
    (await GET(callback(proof, "&returnTo=https://evil.test"))).headers.get(
      "location",
    ),
  ).toBe("https://staging.oneonly.lol/app?x=linked");
  const tokenId = "e3cecf42-93f0-420e-a94f-8d4c94840adf";
  expect(
    (await GET(callback({ ...proof, tokenId }))).headers.get("location"),
  ).toBe(`https://staging.oneonly.lol/app/token/${tokenId}?x=linked#comments`);
});
it("does not refresh proof for expired assertions, wrong wallet or invalid return paths", async () => {
  for (const value of [
    { ...proof, expires: Date.now() - 1 },
    { ...proof, returnTo: "https://evil.test" } as unknown as XLink,
  ]) {
    expect((await GET(callback(value))).headers.get("location")).toBe(
      "https://staging.oneonly.lol/app?x=failed",
    );
  }
  calls.wallet.mockResolvedValue("different-wallet");
  expect(
    (
      await GET(callback({ ...proof, returnTo: "/app/creator-fees" }))
    ).headers.get("location"),
  ).toBe("https://staging.oneonly.lol/app/creator-fees?x=failed");
  expect(calls.db).not.toHaveBeenCalled();
});
