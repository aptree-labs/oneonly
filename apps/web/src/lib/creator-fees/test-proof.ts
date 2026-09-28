import { createHash, timingSafeEqual } from "node:crypto";
import { FeeError } from "./provider";

type TestScope = {
  network: string;
  wallet: string;
  xId: string;
  bindingVersion: number;
  tokenId: string;
  mint: string;
};
type TestGrant = TestScope & { hash: string; expiresAt: string };

/** Operator-issued, single-use staging proof. Never returned by a public API. */
export function verifyInternalTestProof(
  input: string,
  scope: TestScope,
  now = new Date(),
) {
  const code = input.trim();
  if (!code.startsWith("OO-TEST-")) return null;
  const reject = () => new FeeError("This test code is invalid or expired.");
  if (process.env.ONEONLY_ENVIRONMENT !== "staging") throw reject();
  let grant: TestGrant;
  try {
    grant = JSON.parse(process.env.CREATOR_FEE_TEST_GRANT || "null");
  } catch {
    throw reject();
  }
  if (
    !grant ||
    !/^[0-9a-f]{64}$/.test(grant.hash) ||
    !/^OO-TEST-[0-9a-f]{32}$/.test(code) ||
    !Number.isFinite(Date.parse(grant.expiresAt)) ||
    Date.parse(grant.expiresAt) <= now.getTime() ||
    (
      ["network", "wallet", "xId", "bindingVersion", "tokenId", "mint"] as const
    ).some((key) => grant[key] !== scope[key])
  )
    throw reject();
  const hash = createHash("sha256").update(code).digest();
  if (!timingSafeEqual(hash, Buffer.from(grant.hash, "hex"))) throw reject();
  // The existing unique evidence constraint consumes this grant atomically,
  // even if requests race against separate claim challenges.
  return { tweetId: `internal-test:${grant.hash}`, publishedAt: now };
}
