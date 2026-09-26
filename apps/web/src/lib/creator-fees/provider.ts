import { safeXAvatar } from "../x-link";
export class FeeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type FeeProfile = {
  xId: string;
  username: string;
  name: string;
  avatar: string | null;
};
export function xHandle(input: string) {
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (
      !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
        url.hostname,
      ) ||
      url.protocol !== "https:"
    )
      throw new FeeError("Enter an X handle or profile link.");
    value = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  value = value.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(value))
    throw new FeeError("Enter a valid X handle.");
  return value;
}
export function tweetIdFromUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FeeError("Paste the link to your X post.");
  }
  const match = url.pathname.match(
    /^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/([0-9]{1,25})\/?$/,
  );
  if (
    url.protocol !== "https:" ||
    !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
      url.hostname,
    ) ||
    !match
  )
    throw new FeeError("Paste a valid X post link.");
  return match[1];
}
async function request(
  path: string,
  params: Record<string, string>,
  fetcher: typeof fetch = fetch,
) {
  if (!process.env.TWITTERAPI_IO_API_KEY)
    throw new FeeError("X verification is not configured yet.", 503);
  const url = new URL(path, "https://api.twitterapi.io");
  url.search = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { "X-API-Key": process.env.TWITTERAPI_IO_API_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new FeeError(
      "X verification is temporarily unavailable. Try again shortly.",
      503,
    );
  }
  if (!response.ok)
    throw new FeeError(
      "X verification is temporarily unavailable. Try again shortly.",
      503,
    );
  const body = await response.json();
  if (!body || body.status !== "success")
    throw new FeeError(
      "X could not return this account or post. Please retry.",
      503,
    );
  return body;
}
export async function lookupX(
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<FeeProfile> {
  const handle = xHandle(input),
    body = await request("/twitter/user/info", { userName: handle }, fetcher),
    p = body.data;
  if (
    !p ||
    p.unavailable ||
    typeof p.id !== "string" ||
    !/^[1-9]\d{0,24}$/.test(p.id) ||
    typeof p.userName !== "string" ||
    p.userName.toLowerCase() !== handle.toLowerCase() ||
    typeof p.name !== "string"
  )
    throw new FeeError("That X account could not be found.", 404);
  return {
    xId: p.id,
    username: p.userName,
    name: p.name.slice(0, 200),
    avatar: safeXAvatar(p.profilePicture),
  };
}
export type PostChallenge = {
  xId: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
};
export function verifyPostEvidence(
  tweet: unknown,
  id: string,
  challenge: PostChallenge,
  now = new Date(),
) {
  const p = tweet as Record<string, unknown> | null;
  const author = p?.author as Record<string, unknown> | null;
  if (!p || p.id !== id || author?.id !== challenge.xId)
    throw new FeeError("The post must be published by the linked X account.");
  if (
    p.isReply !== false ||
    p.retweeted_tweet ||
    p.quoted_tweet ||
    p.isRetweet === true ||
    typeof p.text !== "string" ||
    /^RT\s@/.test(p.text)
  )
    throw new FeeError(
      "Publish a new original post using the provided verification text.",
    );
  const published =
    typeof p.createdAt === "string" ? Date.parse(p.createdAt) : NaN;
  if (
    !Number.isFinite(published) ||
    published < challenge.createdAt.getTime() ||
    published > now.getTime() ||
    now >= challenge.expiresAt ||
    published >= challenge.expiresAt.getTime()
  )
    throw new FeeError(
      "This verification post is too old or the request has expired.",
    );
  if (!p.text.split(/\s+/).includes(challenge.code))
    throw new FeeError("The post must contain the exact verification code.");
  return { tweetId: id, publishedAt: new Date(published) };
}
export async function verifyXPost(
  url: string,
  challenge: PostChallenge,
  fetcher: typeof fetch = fetch,
  now = new Date(),
) {
  const id = tweetIdFromUrl(url),
    body = await request("/twitter/tweets", { tweet_ids: id }, fetcher);
  const tweet = Array.isArray(body.tweets)
    ? body.tweets.find((p: { id?: string }) => p.id === id)
    : null;
  if (!tweet)
    throw new FeeError(
      "Your post is not visible yet. Wait a moment and verify again.",
      409,
    );
  return verifyPostEvidence(tweet, id, challenge, now);
}
