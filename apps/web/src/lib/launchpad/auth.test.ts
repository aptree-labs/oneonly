import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPrivateKey, sign } from "node:crypto";
import { Keypair, NETWORK } from "@oneonly/protocol";
import { walletChain } from "@oneonly/core";
import { createLocalDatabase, walletChallenges, eq } from "@oneonly/db";
import bs58 from "bs58";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const cookie = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => cookie }));
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<typeof import("@oneonly/db")>()),
  getDatabase: async () => local.db,
}));
import { challenge, verifyChallenge } from "./auth";

beforeAll(async () => {
  vi.stubEnv("LAUNCHPAD_URL", "https://app.oneonly.lol");
  local = await createLocalDatabase();
});
afterAll(async () => {
  await local.client.close();
  vi.unstubAllEnvs();
});
function signature(wallet: Keypair, message: string) {
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(wallet.secretKey.slice(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return bs58.encode(sign(null, Buffer.from(message), key));
}

it("creates a wallet-displayable SIWS message with an alphanumeric nonce", async () => {
  const wallet = Keypair.generate();
  const address = wallet.publicKey.toBase58();
  const first = await challenge(address);
  const second = await challenge(address);
  // SIWS ABNF requires 8*(ALPHA / DIGIT). UUID hyphens are invalid even
  // though the same UUID remains a valid database challenge identifier.
  const nonce = first.message.match(/^Nonce: (.+)$/m)?.[1];
  expect(nonce).toMatch(/^[A-Za-z0-9]{8,}$/);
  expect(second.message.match(/^Nonce: (.+)$/m)?.[1]).not.toBe(nonce);
  expect(first.message).toContain(
    `app.oneonly.lol wants you to sign in with your Solana account:\n${address}\n\n`,
  );
  expect(first.message).toContain(
    `\nURI: https://app.oneonly.lol\nVersion: 1\nChain ID: ${walletChain(NETWORK)}\n`,
  );
  const issued = Date.parse(first.message.match(/^Issued At: (.+)$/m)![1]);
  const expires = Date.parse(
    first.message.match(/^Expiration Time: (.+)$/m)![1],
  );
  expect(expires - issued).toBeGreaterThan(299_000);
  expect(expires - issued).toBeLessThanOrEqual(300_000);
  const [stored] = await local.db
    .select()
    .from(walletChallenges)
    .where(eq(walletChallenges.id, first.id));
  expect(stored.message).toBe(first.message);
});

it("verifies the exact sign-in bytes once and sets a secure session", async () => {
  const wallet = Keypair.generate();
  const request = await challenge(wallet.publicKey.toBase58());
  const signed = signature(wallet, request.message);
  expect(await verifyChallenge(request.id, signed)).toEqual({
    wallet: wallet.publicKey.toBase58(),
  });
  expect(cookie.set).toHaveBeenCalledWith(
    `oneonly-wallet-${NETWORK}`,
    expect.any(String),
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    }),
  );
  await expect(verifyChallenge(request.id, signed)).rejects.toThrow(
    "already used",
  );
});

it("rejects another wallet's signature and consumes the challenge", async () => {
  const wallet = Keypair.generate();
  const request = await challenge(wallet.publicKey.toBase58());
  await expect(
    verifyChallenge(request.id, signature(Keypair.generate(), request.message)),
  ).rejects.toThrow("could not be verified");
  await expect(
    verifyChallenge(request.id, signature(wallet, request.message)),
  ).rejects.toThrow("already used");
});

it("rejects expired challenges", async () => {
  const wallet = Keypair.generate();
  const request = await challenge(wallet.publicKey.toBase58());
  await local.db
    .update(walletChallenges)
    .set({ expiresAt: new Date(0) })
    .where(eq(walletChallenges.id, request.id));
  await expect(
    verifyChallenge(request.id, signature(wallet, request.message)),
  ).rejects.toThrow("expired");
});
