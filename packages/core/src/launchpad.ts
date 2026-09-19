import { Data, Effect, Schema } from "effect";
export const TOKEN_SUPPLY = 1_000_000_000;
export const TOKEN_DECIMALS = 6;
export const DAY = 86_400_000;
export const QUOTES = ["SOL", "USDC"] as const;
export type QuoteSymbol = (typeof QUOTES)[number];
export class LaunchError extends Data.TaggedError("LaunchError")<{
  message: string;
  status: number;
}> {}
export type ProjectLinks = {
  website?: string;
  telegram?: string;
  discord?: string;
  x?: {
    url: string;
    username: string;
    verified: boolean;
    verifiedAt?: string;
    avatar?: string | null;
  };
};

/** Links are stored as data, never fetched server-side or accepted as executable URLs. */
export function projectUrl(
  raw: string | undefined,
  kind: "website" | "X" | "Telegram" | "Discord",
): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  try {
    if (value.length > 500 || /[\s\\]/.test(value)) throw new Error();
    const url = new URL(value.includes(":") ? value : `https://${value}`);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.includes(".")
    )
      throw new Error();
    const host = url.hostname.replace(/^www\./, "");
    if (kind === "X") {
      if (
        !["x.com", "twitter.com"].includes(host) ||
        url.port ||
        !/^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname)
      )
        throw new Error();
      const username = url.pathname.split("/")[1];
      if (
        [
          "home",
          "explore",
          "search",
          "intent",
          "settings",
          "messages",
          "i",
          "share",
        ].includes(username.toLowerCase())
      )
        throw new Error();
      return `https://x.com/${username}`;
    }
    if (
      kind === "Telegram" &&
      (host !== "t.me" || !/^\/[A-Za-z0-9_+\-]+\/?$/.test(url.pathname))
    )
      throw new Error();
    if (
      kind === "Discord" &&
      !(
        (host === "discord.gg" && /^\/[A-Za-z0-9-]+\/?$/.test(url.pathname)) ||
        (host === "discord.com" &&
          /^\/invite\/[A-Za-z0-9-]+\/?$/.test(url.pathname))
      )
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new LaunchError({
      message:
        kind === "X"
          ? "Paste an X profile link, such as https://x.com/yourname."
          : `Enter a valid HTTPS ${kind} link.`,
      status: 400,
    });
  }
}
export function normalizeTicker(raw: string): string {
  if (/[^\x00-\x7F]/.test(raw))
    throw new LaunchError({
      message: "Use ASCII letters and numbers only.",
      status: 400,
    });
  const ticker = raw
    .trim()
    .replace(/^\$/, " ")
    .replace(/\s/g, "")
    .toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(ticker))
    throw new LaunchError({
      message:
        "Use 1–10 letters or numbers for your ticker. Unicode look-alikes aren’t allowed.",
      status: 400,
    });
  return ticker;
}
/** Accept a decimal comma as a decimal separator; grouping separators are never accepted. */
export function normalizeAmount(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed) || trimmed.length > 40)
    throw new LaunchError({
      message:
        "Enter an amount using one decimal point or comma, without grouping separators.",
      status: 400,
    });
  return trimmed.replace(",", ".");
}
export function amountReference(
  value: string,
  price: number | null | undefined,
): string | null {
  try {
    const total = Number(normalizeAmount(value)) * (price ?? NaN);
    return Number.isFinite(total) && total >= 0 ? total.toFixed(2) : null;
  } catch {
    return null;
  }
}
/** Decimal user input is converted with integer arithmetic, never IEEE floating point. */
export function parseUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value) || value.length > 40)
    throw new LaunchError({
      message: "Enter a positive decimal amount.",
      status: 400,
    });
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new LaunchError({
      message: `Use no more than ${decimals} decimal places.`,
      status: 400,
    });
  const amount =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n)
    throw new LaunchError({
      message: "Amount is outside the supported range.",
      status: 400,
    });
  return amount;
}
export function formatUnits(value: string | bigint, decimals: number): string {
  const amount = BigInt(value),
    base = 10n ** BigInt(decimals);
  const fraction = (amount % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${amount / base}${fraction ? `.${fraction}` : ""}`;
}
export function validateSlippage(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 10 ||
    value > 500
  )
    throw new LaunchError({
      message: "Slippage must be between 0.1% and 5%.",
      status: 400,
    });
  return value;
}
const LaunchInput = Schema.Struct({
  ticker: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  website: Schema.optional(Schema.String),
  xUrl: Schema.optional(Schema.String),
  xSource: Schema.optional(Schema.Literal("link", "connected")),
  telegram: Schema.optional(Schema.String),
  discord: Schema.optional(Schema.String),
  imageId: Schema.String,
  quote: Schema.String,
  initialBuy: Schema.optional(Schema.String),
  payment: Schema.optional(Schema.String),
  slippageBps: Schema.Number,
});
export const validateLaunch = (input: unknown) =>
  Schema.decodeUnknown(LaunchInput)(input).pipe(
    Effect.mapError(
      () =>
        new LaunchError({
          message: "Complete all of the token details.",
          status: 400,
        }),
    ),
    Effect.flatMap((data) =>
      Effect.try({
        try: () => {
          const ticker = normalizeTicker(data.ticker),
            name = data.name.trim(),
            description = (data.description ?? "").trim();
          if (name.length < 1 || new TextEncoder().encode(name).length > 32)
            throw new LaunchError({
              message: "Token names must be 1–32 UTF-8 bytes.",
              status: 400,
            });
          if (description.length > 500)
            throw new LaunchError({
              message: "Keep the story under 501 characters.",
              status: 400,
            });
          if (!/^[0-9a-f-]{36}$/.test(data.imageId))
            throw new LaunchError({
              message: "Upload a token image first.",
              status: 400,
            });
          validateSlippage(data.slippageBps);
          if (!/^[A-Z][A-Z0-9]{0,11}$/.test(data.quote))
            throw new LaunchError({
              message: "Choose a supported quote asset.",
              status: 400,
            });
          // The protocol allowlist verifies membership and exact mint decimals before creating a transaction.
          const normalized = data.initialBuy?.trim()
            ? normalizeAmount(data.initialBuy)
            : "0";
          const initialBuy = /^0+(?:\.0+)?$/.test(normalized)
            ? "0"
            : normalized;
          if (initialBuy !== "0") parseUnits(initialBuy, 9);
          if (
            data.payment !== undefined &&
            data.payment !== "SOL" &&
            data.payment !== data.quote
          )
            throw new LaunchError({
              message: "Choose SOL or the pool quote asset for payment.",
              status: 400,
            });
          return {
            ...data,
            initialBuy,
            ticker,
            name,
            description,
            website: projectUrl(data.website, "website"),
            xUrl: projectUrl(data.xUrl, "X"),
            telegram: projectUrl(data.telegram, "Telegram"),
            discord: projectUrl(data.discord, "Discord"),
          };
        },
        catch: (error) =>
          error instanceof LaunchError
            ? error
            : new LaunchError({
                message: "Invalid token details.",
                status: 400,
              }),
      }),
    ),
  );
/** Three complete UTC days, each below $100, with complete indexing for every pool. */
export function canReleaseTicker(
  pools: {
    createdAt: Date;
    indexedThrough: Date | null;
    coverageStart: Date | null;
    dailyVolumes: { usd: number | null; day: string }[];
    hasUnknownVolume: boolean;
  }[],
  now: Date,
): boolean {
  if (!pools.length) return false;
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(midnight.getTime() - 3 * DAY);
  return pools.every((pool) => {
    if (
      pool.createdAt > start ||
      !pool.indexedThrough ||
      pool.indexedThrough < midnight ||
      !pool.coverageStart ||
      pool.coverageStart > start ||
      pool.hasUnknownVolume
    )
      return false;
    const today = midnight.toISOString().slice(0, 10);
    if (
      pool.dailyVolumes
        .filter((row) => row.day === today)
        .reduce((sum, row) => sum + (row.usd ?? 0), 0) >= 100
    )
      return false;
    return [1, 2, 3].every((offset) => {
      const day = new Date(midnight.getTime() - offset * DAY)
        .toISOString()
        .slice(0, 10);
      const records = pool.dailyVolumes.filter((row) => row.day === day);
      return (
        records.every((row) => row.usd !== null) &&
        records.reduce((sum, row) => sum + (row.usd ?? 0), 0) < 100
      );
    });
  });
}
