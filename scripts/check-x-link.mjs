// No chain transactions or X consent: uses an ephemeral wallet's off-chain signature.
import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(resolve("apps/web/package.json"));
const bs58 = require("bs58").default;
const app = "https://app.oneonly.lol";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const wallet = bs58.encode(
  publicKey.export({ format: "der", type: "spki" }).subarray(-32),
);
const jar = new Map();
async function call(path, body) {
  const response = await fetch(`${app}/api/launchpad/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: app,
      "Content-Type": "application/json",
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  assert.ok(
    response.ok,
    `App endpoint ${path.split("?")[0]} returned ${response.status}`,
  );
  return { data: await response.json(), response };
}
try {
  const { data: challenge } = await call("challenge", { wallet });
  const signature = bs58.encode(
    sign(null, Buffer.from(challenge.message), privateKey),
  );
  const { response: login } = await call("verify", {
    id: challenge.id,
    signature,
  });
  assert.ok(
    login.headers.getSetCookie().some((c) => /SameSite=strict/i.test(c)),
  );
  const { data: profile } = await call("profile");
  assert.equal(profile.wallet, wallet);
  assert.equal(profile.available, true);
  assert.equal(profile.profile, null);
  const { data: link, response } = await call("link-x", { tokenId: "" });
  assert.equal(new URL(link.url).origin, "https://oneonly.lol");
  assert.ok(
    response.headers
      .getSetCookie()
      .some(
        (c) =>
          c.startsWith("oneonly-x-session=") &&
          /SameSite=lax/i.test(c) &&
          c.includes("Path=/api/launchpad/x-callback"),
      ),
  );
  const oauth = await fetch(link.url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const location = new URL(oauth.headers.get("location"));
  assert.equal(location.origin, "https://x.com");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    location.searchParams.get("redirect_uri"),
    "https://oneonly.lol/api/auth/x/callback",
  );
  assert.ok(
    oauth.headers
      .getSetCookie()
      .some((c) => c.startsWith("x_app_link=") && !c.includes("Max-Age=0")),
  );
  const invalid = await fetch(
    `${app}/api/launchpad/x-callback?profile=invalid`,
    { redirect: "manual", signal: AbortSignal.timeout(20_000) },
  );
  assert.equal(
    new URL(invalid.headers.get("location")).searchParams.get("x"),
    "failed",
  );
  const waitlist = await fetch("https://oneonly.lol/api/auth/x", {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(
    new URL(waitlist.headers.get("location")).origin,
    "https://x.com",
  );
  console.log(
    JSON.stringify({
      authenticatedProfileRead: true,
      sharedXHandoff: true,
      pkce: true,
      callbackScopedSession: true,
      forgedProfileRejected: true,
      waitlistOAuthPreserved: true,
      realXConsentNotPerformed: true,
    }),
  );
} finally {
  if (jar.size) await call("logout", {});
}
