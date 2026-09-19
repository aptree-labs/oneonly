import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ profiles: [] as object[] }));
vi.mock("@oneonly/db", () => ({
  getDatabase: async () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => mocks.profiles }) }),
    }),
  }),
  walletProfiles: { wallet: "wallet" },
  eq: vi.fn(),
}));
vi.mock("./auth", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
}));
import { resolveProjectLinks } from "./project-links";
beforeEach(() => {
  mocks.profiles = [];
});
it("pasted links cannot grant verification even when extra flags are submitted", async () => {
  const data = await resolveProjectLinks("wallet", {
    xUrl: "https://x.com/project",
    xSource: "link",
    verified: true,
  } as any);
  expect(data.x?.verified).toBe(false);
});
it("only the server's wallet-linked profile grants verification", async () => {
  await expect(
    resolveProjectLinks("wallet", { xSource: "connected" }),
  ).rejects.toThrow("Connect an X account");
  mocks.profiles = [{ xUsername: "creator", xAvatar: null }];
  const data = await resolveProjectLinks("wallet", {
    xSource: "connected",
    xUrl: "https://x.com/creator",
  });
  expect(data.x).toMatchObject({
    username: "creator",
    url: "https://x.com/creator",
    verified: true,
  });
  expect(data.x?.verifiedAt).toBeTruthy();
  await expect(
    resolveProjectLinks("wallet", {
      xSource: "connected",
      xUrl: "https://x.com/imposter",
    }),
  ).rejects.toThrow("profile changed");
});
