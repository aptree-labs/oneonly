import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupX,
  tweetIdFromUrl,
  verifyPostEvidence,
  verifyXPost,
  xHandle,
} from "./provider";
afterEach(() => vi.unstubAllEnvs());
const createdAt = new Date("2026-09-26T10:00:00Z"),
  expiresAt = new Date("2026-09-26T10:10:00Z"),
  now = new Date("2026-09-26T10:01:00Z");
const challenge = { xId: "123", code: "ONEONLY-secret", createdAt, expiresAt };
const post = {
  id: "456",
  author: { id: "123", userName: "renamed" },
  text: "Verification\nONEONLY-secret",
  isReply: false,
  createdAt: "2026-09-26T10:00:30Z",
};
describe("fresh X proof", () => {
  it("accepts an exact token and stable numeric author despite renamed handle", () => {
    expect(verifyPostEvidence(post, "456", challenge, now).tweetId).toBe("456");
  });
  it.each([
    { author: { id: "999" } },
    { id: "999" },
    { text: "ONEONLY-secret-suffix" },
    { text: "prefixONEONLY-secret" },
    { isReply: true },
    { isReply: undefined },
    { retweeted_tweet: { id: "12" } },
    { quoted_tweet: { id: "12" } },
    { createdAt: "2026-09-26T09:59:59Z" },
    { createdAt: "2026-09-26T10:02:00Z" },
    { createdAt: "invalid" },
  ])(
    "rejects incorrect author, scope token, timing, and non-original posts %j",
    (override) => {
      expect(() =>
        verifyPostEvidence({ ...post, ...override }, "456", challenge, now),
      ).toThrow();
    },
  );
  it("rejects expired challenges", () =>
    expect(() =>
      verifyPostEvidence(post, "456", challenge, expiresAt),
    ).toThrow());
  it("rejects URL tricks rather than fetching arbitrary domains", () => {
    expect(tweetIdFromUrl("https://x.com/name/status/456")).toBe("456");
    for (const url of [
      "https://x.com.evil.test/name/status/456",
      "https://evil.test/name/status/456",
      "http://x.com/name/status/456",
      "https://x.com/name/status/456/anything",
    ])
      expect(() => tweetIdFromUrl(url)).toThrow();
    expect(xHandle("https://x.com/oneonlylol")).toBe("oneonlylol");
  });
  it("fails closed without provider credentials", async () => {
    await expect(lookupX("oneonlylol")).rejects.toThrow("configured");
  });
  it("uses API-key server request, validates profile identity, and rejects foreign avatars", async () => {
    vi.stubEnv("TWITTERAPI_IO_API_KEY", "test");
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        status: "success",
        data: {
          id: "123",
          userName: "OneOnlylol",
          name: "One Only",
          profilePicture: "https://evil.test/photo",
        },
      }),
    );
    expect(await lookupX("oneonlylol", fetcher)).toEqual({
      xId: "123",
      username: "OneOnlylol",
      name: "One Only",
      avatar: null,
    });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.twitterapi.io/twitter/user/info?userName=oneonlylol",
    );
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("verifies provider tweet by exact ID without trusting a supplied profile name", async () => {
    vi.stubEnv("TWITTERAPI_IO_API_KEY", "test");
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "success", tweets: [post] }));
    await expect(
      verifyXPost("https://x.com/anything/status/456", challenge, fetcher, now),
    ).resolves.toMatchObject({ tweetId: "456" });
  });
});

const proofUrl = "https://oneonly.lol/app/token/token-1?share=claim-1";
const linkedChallenge = { ...challenge, proofUrl };
const linkedPost = {
  ...post,
  text: "Trade $ANDY on OneOnly. https://t.co/abc",
  entities: { urls: [{ url: "https://t.co/abc", expanded_url: proofUrl }] },
};
describe("token-link claim proof", () => {
  it("accepts the exact token link, directly or shortened by X", () => {
    expect(
      verifyPostEvidence(linkedPost, "456", linkedChallenge, now).tweetId,
    ).toBe("456");
    expect(
      verifyPostEvidence(
        { ...post, text: `Trade $ANDY ${proofUrl}` },
        "456",
        linkedChallenge,
        now,
      ).tweetId,
    ).toBe("456");
  });
  it.each([
    proofUrl.replace("oneonly.lol", "oneonly.lol.evil.test"),
    proofUrl.replace("token-1", "token-2"),
    proofUrl.replace("claim-1", "claim-2"),
    proofUrl.replace("https:", "http:"),
    `${proofUrl}-suffix`,
    `https://evil.test/?redirect=${proofUrl}`,
  ])("rejects a different destination or claim: %s", (expanded_url) => {
    expect(() =>
      verifyPostEvidence(
        {
          ...linkedPost,
          entities: { urls: [{ url: "https://t.co/abc", expanded_url }] },
        },
        "456",
        linkedChallenge,
        now,
      ),
    ).toThrow();
  });
  it("does not accept a URL entity absent from the post text", () => {
    expect(() =>
      verifyPostEvidence(
        { ...linkedPost, text: "No token link" },
        "456",
        linkedChallenge,
        now,
      ),
    ).toThrow();
  });
  it("still requires a fresh original post from the allocated account", () => {
    for (const override of [
      { author: { id: "999" } },
      { isReply: true },
      { quoted_tweet: {} },
      { createdAt: "2026-09-26T09:59:00Z" },
    ]) {
      expect(() =>
        verifyPostEvidence(
          { ...linkedPost, ...override },
          "456",
          linkedChallenge,
          now,
        ),
      ).toThrow();
    }
    expect(() =>
      verifyPostEvidence(linkedPost, "456", linkedChallenge, expiresAt),
    ).toThrow();
  });
});

it("verifies the Explore proof and keeps in-flight token proofs valid", () => {
  const exploreUrl = "https://oneonly.lol/app?share=claim-1";
  const current = {
    ...challenge,
    proofUrl: exploreUrl,
    legacyProofUrl: proofUrl,
  };
  const explorePost = {
    ...linkedPost,
    text: "Claimed creator fees on @oneonlylol. https://t.co/abc",
    entities: { urls: [{ url: "https://t.co/abc", expanded_url: exploreUrl }] },
  };
  expect(verifyPostEvidence(explorePost, "456", current, now).tweetId).toBe(
    "456",
  );
  expect(verifyPostEvidence(linkedPost, "456", current, now).tweetId).toBe(
    "456",
  );
  expect(() =>
    verifyPostEvidence(
      {
        ...explorePost,
        entities: {
          urls: [
            {
              url: "https://t.co/abc",
              expanded_url: exploreUrl.replace("claim-1", "claim-2"),
            },
          ],
        },
      },
      "456",
      current,
      now,
    ),
  ).toThrow();
});
