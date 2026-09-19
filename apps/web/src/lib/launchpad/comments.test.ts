import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLocalDatabase,
  launchTokens,
  tokenBuyers,
  tokenComments,
  walletProfiles,
} from "@oneonly/db";
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const tokenId = randomUUID();
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<typeof import("@oneonly/db")>()),
  getDatabase: async () => local.db,
}));
vi.mock("./transactions", () => ({
  tokenById: async () => ({ id: tokenId, mint: "fixture", pool: "fixture" }),
}));
vi.mock("./auth", () => ({
  rateLimit: async () => {},
  fail: (message: string) => {
    throw new Error(message);
  },
  string: (value: unknown) => {
    if (typeof value !== "string") throw new Error("Missing field");
    return value;
  },
}));
import { readComments, postComment, removeComment } from "./comments";
beforeAll(async () => {
  local = await createLocalDatabase();
  await local.db.insert(launchTokens).values({
    id: tokenId,
    network: "devnet",
    ticker: "COMMENTS",
    name: "Comments",
    description: "Fixture",
    imageId: randomUUID(),
    creator: "buyer",
    quote: "SOL",
    mint: "fixture",
    pool: "fixture",
    config: "fixture",
  });
});
afterAll(async () => {
  await local.client.close();
});
it("paginates equal timestamps without losing or duplicating comments", async () => {
  await local.db.insert(tokenComments).values(
    Array.from({ length: 32 }, (_, i) => ({
      tokenId,
      wallet: "buyer",
      body: String(i),
      purchaseSignature: "fixture",
      createdAt: new Date("2026-09-15T00:00:00Z"),
    })),
  );
  const first = await readComments(tokenId),
    second = await readComments(tokenId, first.next);
  expect(first.comments).toHaveLength(30);
  expect(second.comments).toHaveLength(2);
  expect(
    new Set([...first.comments, ...second.comments].map((row) => row.id)).size,
  ).toBe(32);
  expect(second.next).toBeNull();
});
it("requires a verified purchase and only allows the author to delete", async () => {
  await expect(
    postComment("not-a-buyer", { tokenId, body: "A fake buyer" }),
  ).rejects.toThrow("No finalized One Only purchase");
  await local.db
    .insert(tokenBuyers)
    .values({ tokenId, wallet: "buyer", signature: "verified-fixture" });
  const { comment } = await postComment("buyer", {
    tokenId,
    body: "<script>plain text</script>",
  });
  expect(comment.body).toBe("<script>plain text</script>");
  expect(comment.purchaseSignature).toBe("verified-fixture");
  await expect(removeComment("other-wallet", comment.id)).rejects.toThrow(
    "Comment not found",
  );
  expect(await removeComment("buyer", comment.id)).toEqual({ removed: true });
});

it("returns only the verified wallet-linked X profile on current and past comments", async () => {
  vi.stubEnv("X_LINK_SECRET", "test-only");
  await local.db.insert(walletProfiles).values({
    wallet: "buyer",
    xId: "123",
    xUsername: "real_buyer",
    xAvatar: "https://pbs.twimg.com/profile_images/123/x.jpg",
  });
  const { comment } = await postComment("buyer", {
    tokenId,
    body: "Linked profile",
    profile: { username: "spoofed" },
  });
  expect(comment.profile?.username).toBe("real_buyer");
  const page = await readComments(tokenId);
  expect(
    page.comments.find((row) => row.id === comment.id)?.profile?.username,
  ).toBe("real_buyer");
});
