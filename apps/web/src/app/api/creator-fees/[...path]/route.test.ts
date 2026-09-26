import { beforeEach, expect, it, vi } from "vitest";
import { LaunchError } from "@oneonly/core";
const calls = vi.hoisted(() => ({
  gate: vi.fn(),
  status: vi.fn(),
  profile: vi.fn(),
  bind: vi.fn(),
  verify: vi.fn(),
  wallet: vi.fn(),
  origin: vi.fn(),
  rate: vi.fn(),
  claim: vi.fn(),
}));
vi.mock("@/lib/creator-fees/service", async () => {
  const { FeeError } = await import("@/lib/creator-fees/provider");
  return {
    FeeError,
    feeStatus: calls.status,
    assertFeeFeature: calls.gate,
    findFeeProfile: calls.profile,
    feeDashboard: vi.fn(),
    bindFeeWallet: calls.bind,
    feeRecipients: vi.fn(),
    feeRecipient: vi.fn(),
    createFeeChallenge: vi.fn(),
    verifyFeeChallenge: calls.verify,
  };
});
vi.mock("@/lib/creator-fees/projections", () => ({
  warmFeeSnapshots: vi.fn(),
}));
vi.mock("@/lib/creator-fees/transactions", () => ({
  prepareCreatorFeeClaim: calls.claim,
  reconcileCreatorFeeClaim: vi.fn(),
  prepareCreatorFeeCollection: vi.fn(),
}));
vi.mock("@/lib/launchpad/auth", () => ({
  checkOrigin: calls.origin,
  requireWallet: calls.wallet,
  rateLimit: calls.rate,
  jsonBody: (r: Request) => r.json(),
  string: (v: unknown) => {
    if (typeof v !== "string")
      throw new LaunchError({ message: "Invalid input", status: 400 });
    return v;
  },
}));
import { GET, POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  calls.gate.mockReset();
  calls.origin.mockReset();
  calls.wallet.mockReset().mockResolvedValue("signed-wallet");
  calls.status.mockResolvedValue({ enabled: false });
  calls.bind.mockResolvedValue({ wallet: "signed-wallet" });
});
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const request = (path: string, body: unknown) =>
  new Request(`https://staging.oneonly.lol/api/creator-fees/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
it("rejects feature requests before lookup when production gating fails", async () => {
  calls.gate.mockImplementation(() => {
    throw new LaunchError({ message: "Not available", status: 404 });
  });
  const result = await GET(
    new Request("https://oneonly.lol/api/creator-fees/profiles?q=person"),
    context("profiles"),
  );
  expect(result.status).toBe(404);
  expect(calls.profile).not.toHaveBeenCalled();
  expect(
    (
      await GET(
        new Request("https://oneonly.lol/api/creator-fees/status"),
        context("status"),
      )
    ).status,
  ).toBe(200);
});
it("rejects cross-origin writes before wallet or financial service access", async () => {
  calls.origin.mockImplementation(() => {
    throw new LaunchError({ message: "Invalid origin", status: 403 });
  });
  expect(
    (await POST(request("claim", { challengeId: "test" }), context("claim")))
      .status,
  ).toBe(403);
  expect(calls.wallet).not.toHaveBeenCalled();
  expect(calls.claim).not.toHaveBeenCalled();
});
it("does not accept a body-supplied wallet instead of the signed session", async () => {
  const result = await POST(
    request("bind", { wallet: "attacker-wallet", xId: "attacker-id" }),
    context("bind"),
  );
  expect(result.status).toBe(200);
  expect(calls.bind).toHaveBeenCalledExactlyOnceWith("signed-wallet");
});
it("blocks unsigned wallet claims before preparation", async () => {
  calls.wallet.mockRejectedValue(
    new LaunchError({ message: "Sign in", status: 401 }),
  );
  expect(
    (await POST(request("claim", { challengeId: "test" }), context("claim")))
      .status,
  ).toBe(401);
  expect(calls.claim).not.toHaveBeenCalled();
});
