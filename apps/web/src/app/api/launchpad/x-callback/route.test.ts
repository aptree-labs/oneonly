import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import {
  walletSessionCookie,
  X_SESSION_COOKIE,
  verifyXSession,
} from "@/lib/x-session";
import { signXLink } from "@/lib/x-link";
const state = vi.hoisted(() => ({
  session: vi.fn(),
  save: vi.fn(),
  values: vi.fn(),
}));
vi.mock("@/lib/launchpad/auth", () => ({
  origin: () => "https://app.oneonly.lol",
  session: state.session,
}));
vi.mock("@oneonly/db", () => ({
  walletProfiles: { wallet: "wallet" },
  getDatabase: async () => ({ insert: () => ({ values: state.values }) }),
}));
import { GET } from "./route";
const wallet = "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR";
beforeEach(() => {
  vi.stubEnv("X_LINK_SECRET", randomBytes(32).toString("hex"));
  state.session.mockResolvedValue(wallet);
  state.save.mockResolvedValue(undefined);
  state.values.mockImplementation(() => ({ onConflictDoUpdate: state.save }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function request(
  nonce: string,
  browserNonce = nonce,
  returnTo?: "/app/create",
) {
  const ticket = signXLink({
    purpose: "profile",
    returnTo,
    nonce,
    wallet,
    tokenId: "",
    expires: Date.now() + 60_000,
    xId: "1234",
    username: "verified_user",
    avatar: "https://pbs.twimg.com/profile_images/1234/pic.jpg",
  });
  return new NextRequest(
    `https://app.oneonly.lol/api/launchpad/x-callback?profile=${ticket}`,
    {
      headers: {
        cookie: `oneonly-x-link=${browserNonce}; ${walletSessionCookie()}=test-wallet-session; oneonly-x-session=test-wallet-session`,
      },
    },
  );
}
it("stores a verified profile and returns global linking to Explore", async () => {
  const response = await GET(request(randomBytes(32).toString("base64url")));
  expect(response.headers.get("location")).toBe(
    "https://app.oneonly.lol/app?x=linked",
  );
  expect(state.values).toHaveBeenCalledWith(
    expect.objectContaining({
      wallet,
      xId: "1234",
      xUsername: "verified_user",
    }),
  );
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rejects callbacks from another browser or wallet without saving a profile", async () => {
  const nonce = randomBytes(32).toString("base64url");
  expect(
    (await GET(request(nonce, "wrong-browser"))).headers.get("location"),
  ).toContain("x=failed");
  state.session.mockResolvedValue("different-wallet");
  expect((await GET(request(nonce))).headers.get("location")).toContain(
    "x=failed",
  );
  expect(state.save).not.toHaveBeenCalled();
});

it("uses only the callback-scoped session when Strict cookies are withheld on the X redirect", async () => {
  state.session.mockImplementation(async (name?: string) =>
    name === "oneonly-x-session" ? wallet : null,
  );
  const response = await GET(request(randomBytes(32).toString("base64url")));
  expect(response.headers.get("location")).toContain("x=linked");
  expect(response.headers.get("set-cookie")).toContain("oneonly-x-session=");
});
it("does not link an expired/revoked session or override a different signed-in wallet", async () => {
  state.session.mockResolvedValue(null);
  expect(
    (await GET(request(randomBytes(32).toString("base64url")))).headers.get(
      "location",
    ),
  ).toContain("x=failed");
  state.session.mockImplementation(async (name?: string) =>
    name === "oneonly-x-session" ? wallet : "different-wallet",
  );
  expect(
    (await GET(request(randomBytes(32).toString("base64url")))).headers.get(
      "location",
    ),
  ).toContain("x=failed");
  expect(state.save).not.toHaveBeenCalled();
});

it("issues session-bound X ownership only after a valid callback", async () => {
  const response = await GET(request(randomBytes(32).toString("base64url")));
  const identity = state.values.mock.calls[0][0];
  const ownership = response.cookies.get(X_SESSION_COOKIE);
  expect(ownership).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/creator-fees",
  });
  expect(
    verifyXSession(
      ownership!.value,
      {
        wallet,
        xId: identity.xId,
        verifiedAt: identity.linkedAt.getTime(),
      },
      "test-wallet-session",
    ),
  ).toBe(true);
  const rejected = await GET(
    request(randomBytes(32).toString("base64url"), "wrong-nonce"),
  );
  expect(rejected.cookies.get(X_SESSION_COOKIE)).toBeUndefined();
});

it("returns a verified launch link to the launch form", async () => {
  const nonce = randomBytes(32).toString("base64url");
  const response = await GET(request(nonce, nonce, "/app/create"));
  expect(response.headers.get("location")).toBe(
    "https://app.oneonly.lol/app/create?x=linked",
  );
  expect(state.save).toHaveBeenCalledOnce();
});
