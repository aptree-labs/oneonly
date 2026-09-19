import { publicCache } from "@/lib/cache/public-cache";
import { publicPolicy, publicHeaders } from "@/lib/cache/public-policy";
import { redisRateLimitsEnabled } from "@/lib/cache/redis";
import { after } from "next/server";
import { chartHistory } from "@/lib/launchpad/chart-history";
import { tokenDetail } from "@/lib/launchpad/token-detail";
import { discovery, invalidateDiscovery } from "@/lib/launchpad/discovery";
import { walletProfile, beginXLink } from "@/lib/launchpad/profile";
import {
  readComments,
  verifyBuyer,
  postComment,
  removeComment,
} from "@/lib/launchpad/comments";
import { timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import {
  getDatabase,
  launchTokens,
  tickerClaims,
  tokenImages,
  poolSnapshots,
  tokenTrades,
  graduatedIndexes,
  eq,
  and,
  sql,
  desc,
  inArray,
  candleIntervals,
  type CandleInterval,
  type MarketPair,
  type MarketSort,
} from "@oneonly/db";
import {
  normalizeTicker,
  LaunchError,
  formatUnits,
  formatScaledUnits,
} from "@oneonly/core";
import {
  ProtocolError,
  assertNetwork,
  NETWORK,
  configAddress,
  QUOTE_MINTS,
  quoteAssets,
  quoteMultiplier,
  MAINNET_STOCKS,
  MAINNET_TOKENS,
  connection,
  PublicKey,
} from "@oneonly/protocol";
import {
  checkOrigin,
  jsonBody,
  string,
  walletAddress,
  session,
  requireWallet,
  challenge,
  verifyChallenge,
  logout,
  rateLimit,
  fail,
  origin,
} from "@/lib/launchpad/auth";
import {
  launch,
  continueLaunch,
  trade,
  claim,
  migrate,
  submit,
  reviewChangedFee,
  reconcile,
  recentIntents,
  tokenById,
  intentForWallet,
} from "@/lib/launchpad/transactions";
import {
  runIndexer,
  indexPool,
  indexConfirmedTrade,
} from "@/lib/launchpad/indexer";
import { scaledFields } from "@/lib/launchpad/display-units";
import { appConfig } from "@/lib/launchpad/config";
import { preparePoolConfig } from "@/lib/launchpad/setup";
import { tradeAssets } from "@/lib/launchpad/trade-assets";
import { tradePreview } from "@/lib/launchpad/trade-preview";
import { saleShare } from "@/lib/launchpad/sale-share";
import { readOffice, readOfficeFees } from "@/lib/launchpad/office";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const response = (data: unknown) =>
  Response.json(data, { headers: { "Cache-Control": "no-store" } });
async function handle(request: Request, path: string[]) {
  const db = await getDatabase(),
    [action, id] = path;
  if (request.method === "GET") {
    if (action === "sale-share" && id) {
      await rateLimit(
        `sale-share:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
        60,
      );
      return response(
        await saleShare(
          new URL(request.url).searchParams.get("tokenId") ?? "",
          id,
        ),
      );
    }
    if (action === "office") {
      const { pools: _pools, ...totals } = await readOffice();
      return response(totals);
    }
    if (action === "office-fees") return response(await readOfficeFees());
    if (action === "trade-preview" && id) {
      await rateLimit(
        `trade-preview:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
        90,
      );
      const params = new URL(request.url).searchParams;
      return response(
        await tradePreview(await tokenById(id), {
          side: params.get("side"),
          settlement: params.get("settlement"),
          amount: params.get("amount"),
          slippageBps: Number(params.get("slippageBps")),
        }),
      );
    }
    if (action === "trade-assets" && id)
      return response(
        await tradeAssets(
          await tokenById(id),
          new URL(request.url).searchParams.get("wallet"),
        ),
      );
    if (action === "comments" && id)
      return response(
        await readComments(id, new URL(request.url).searchParams.get("before")),
      );
    if (action === "health") {
      await assertNetwork();
      return response({ network: NETWORK, rpcVerified: true });
    }
    if (action === "setup")
      return response({
        network: NETWORK,
        feeWallet: process.env.ONEONLY_FEE_WALLET || null,
        quotes: quoteAssets()
          .filter(
            (asset) =>
              asset.symbol === "SOL" ||
              asset.symbol === "USDC" ||
              [...MAINNET_STOCKS, ...MAINNET_TOKENS].some(
                (quote) => quote.symbol === asset.symbol,
              ),
          )
          .map((asset) => ({
            ...asset,
            setupThreshold: MAINNET_TOKENS.some(
              (token) => token.symbol === asset.symbol,
            )
              ? null
              : (MAINNET_STOCKS.find((stock) => stock.symbol === asset.symbol)
                  ?.setupThreshold ?? (asset.symbol === "SOL" ? 85 : 10_000)),
            setupTargetUsd:
              MAINNET_TOKENS.find((token) => token.symbol === asset.symbol)
                ?.setupTargetUsd ?? null,
          })),
      });
    if (action === "profile") {
      const wallet = await session();
      return response({
        wallet,
        profile: await walletProfile(wallet),
        available: !!process.env.X_LINK_SECRET,
      });
    }
    if (action === "session") return response({ wallet: await session() });
    if (action === "config") return response(await appConfig());
    if (action === "ticker") {
      const ticker = normalizeTicker(
        new URL(request.url).searchParams.get("value") ?? "",
      );
      const [row] = await db
        .select()
        .from(tickerClaims)
        .where(
          and(
            eq(tickerClaims.network, NETWORK),
            eq(tickerClaims.ticker, ticker),
          ),
        );
      return response({ ticker, available: !row, tokenId: row?.tokenId });
    }
    if (action === "tokens") {
      const params = new URL(request.url).searchParams;
      const sort = params.get("sort") ?? "volume",
        pair = params.get("pair") ?? "All",
        age = params.get("age") ?? "All";
      const page = Number(params.get("page") ?? 0),
        search = params.get("search") ?? "";
      if (
        ![
          "volume",
          "market-cap",
          "recent-buys",
          "newest",
          "oldest",
          "relevance",
        ].includes(sort) ||
        ![
          "All",
          "SOL",
          "Stocks",
          "USDC",
          "Tokens",
          ...MAINNET_STOCKS.map((stock) => stock.symbol),
          ...MAINNET_TOKENS.map((token) => token.symbol),
        ].includes(pair) ||
        !["All", "24h", "7d"].includes(age) ||
        !Number.isInteger(page) ||
        page < 0 ||
        page > 10000 ||
        search.length > 100
      )
        fail("Invalid discovery filters.");
      return response(
        await discovery({
          sort: sort as MarketSort,
          pair: pair as MarketPair,
          age: age as "All" | "24h" | "7d",
          search,
          page,
        }),
      );
    }
    if (action === "candles" && id) {
      const token = await tokenById(id);
      const params = new URL(request.url).searchParams;
      const interval = params.get("interval") ?? "15m",
        before = params.has("before")
          ? Number(params.get("before"))
          : undefined;
      if (
        !Object.hasOwn(candleIntervals, interval) ||
        (before !== undefined &&
          (!Number.isSafeInteger(before) ||
            before < 0 ||
            before > Math.floor(Date.now() / 1000)))
      )
        fail("Invalid chart timeframe.");
      const [snapshot] = await db
        .select()
        .from(poolSnapshots)
        .where(eq(poolSnapshots.tokenId, token.id));
      const [graduatedIndex] = snapshot?.graduated
        ? await db
            .select()
            .from(graduatedIndexes)
            .where(eq(graduatedIndexes.tokenId, token.id))
        : [];
      const coverage = snapshot?.graduated
        ? graduatedIndex?.coverageStart &&
          graduatedIndex.indexedThrough &&
          snapshot.indexedThrough
          ? new Date(
              Math.min(
                graduatedIndex.indexedThrough.getTime(),
                snapshot.indexedThrough.getTime(),
              ),
            )
          : null
        : snapshot?.indexedThrough;
      const currency = params.get("currency") === "usd" ? "usd" : "quote";
      const history = await chartHistory(
        db,
        token.id,
        interval as CandleInterval,
        before,
        currency,
        params.get("fallback") === "quote",
      );
      if (
        !history.through &&
        before === undefined &&
        snapshot &&
        (!snapshot.lastIndexAttempt ||
          Date.now() - snapshot.lastIndexAttempt.getTime() > 60_000)
      ) {
        after(async () => {
          // One catch-up per pool per minute across instances, without delaying chart responses.
          const claimed = await db
            .update(poolSnapshots)
            .set({ lastIndexAttempt: new Date() })
            .where(
              and(
                eq(poolSnapshots.tokenId, token.id),
                sql`(${poolSnapshots.lastIndexAttempt} is null or ${poolSnapshots.lastIndexAttempt} < ${new Date(Date.now() - 60_000)})`,
              ),
            )
            .returning();
          if (claimed.length) {
            try {
              await indexPool(token);
              invalidateDiscovery();
            } catch {
              /* Scheduled indexing retries. */
            }
          }
        });
      }
      const multiplier =
        history.currency === "usd" ? 1 : await quoteMultiplier(token.quote);
      return response({
        ...history,
        candles: history.candles.map((bar) =>
          scaledFields(
            bar,
            ["open", "high", "low", "close", "volume"],
            multiplier,
          ),
        ),
        quoteMultiplier: multiplier,
        interval,
        quote: token.quote,
        indexedThrough: coverage ?? null,
        graduatedHistory: !!graduatedIndex?.indexedThrough,
        graduated: snapshot?.graduated ?? false,
      });
    }
    if (action === "token" && id) return response(await tokenDetail(id, true));
    if (action === "metadata" && id) {
      const token = await tokenById(id);
      return Response.json(
        {
          name: token.name,
          symbol: token.ticker,
          description: token.description,
          image: `${origin()}/api/launchpad/image/${token.imageId}`,
          external_url:
            token.projectLinks?.website || `${origin()}/app/token/${id}`,
          ...(token.projectLinks && {
            extensions: {
              website: token.projectLinks.website,
              twitter: token.projectLinks.x?.url,
              telegram: token.projectLinks.telegram,
              discord: token.projectLinks.discord,
            },
          }),
          properties: {
            category: "image",
            ...(token.projectLinks && { project_links: token.projectLinks }),
            files: [
              {
                uri: `${origin()}/api/launchpad/image/${token.imageId}`,
                type: "image/webp",
              },
            ],
          },
        },
        { headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
      );
    }
    if (action === "image" && id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) fail("Image not found.", 404);
      const [image] = await db
        .select()
        .from(tokenImages)
        .where(eq(tokenImages.id, id));
      if (!image) fail("Image not found.", 404);
      return new Response(Buffer.from(image.data, "base64"), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
    if (action === "intent" && id) {
      const wallet = await requireWallet();
      const status = await reconcile(id, wallet);
      if (status.status === "confirmed") {
        invalidateDiscovery();
        if (status.tokenId && status.signature)
          after(async () => {
            try {
              await indexConfirmedTrade(status.tokenId!, status.signature!);
              invalidateDiscovery();
            } catch {
              /* Empty-chart catch-up and the scheduled indexer retry. */
            }
          });
      }
      const intent = await intentForWallet(id, wallet);
      return response({
        ...status,
        transaction:
          status.status === "prepared" ? intent.transaction : undefined,
        details: intent.details,
        kind: intent.kind,
      });
    }
    if (action === "portfolio") {
      const wallet = await requireWallet();
      const tokens = await db
        .select()
        .from(launchTokens)
        .where(
          and(
            eq(launchTokens.network, NETWORK),
            inArray(launchTokens.status, ["active", "released"]),
          ),
        );
      const [balance, accounts, extendedAccounts] = await Promise.all([
        connection().getBalance(new PublicKey(wallet)),
        connection().getParsedTokenAccountsByOwner(new PublicKey(wallet), {
          programId: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          ),
        }),
        connection().getParsedTokenAccountsByOwner(new PublicKey(wallet), {
          programId: new PublicKey(
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          ),
        }),
      ]);
      const balances = new Map<string, bigint>();
      for (const account of [...accounts.value, ...extendedAccounts.value]) {
        const info = account.account.data.parsed.info;
        balances.set(
          info.mint,
          (balances.get(info.mint) ?? 0n) + BigInt(info.tokenAmount.amount),
        );
      }
      return response({
        balance: formatUnits(BigInt(balance), 9),
        quoteBalances: await Promise.all(
          quoteAssets()
            .filter((asset) => !asset.unavailableReason)
            .map(async (asset) => ({
              symbol: asset.symbol,
              mint: asset.mint,
              balance: formatScaledUnits(
                asset.symbol === "SOL"
                  ? BigInt(balance)
                  : (balances.get(asset.mint) ?? 0n),
                asset.decimals,
                await quoteMultiplier(asset.symbol),
              ),
            })),
        ),
        holdings: tokens
          .filter((token) => (balances.get(token.mint) ?? 0n) > 0n)
          .map((token) => ({
            ...token,
            balance: formatUnits(balances.get(token.mint)!, 6),
          })),
        created: tokens.filter((token) => token.creator === wallet),
        intents: await recentIntents(wallet),
      });
    }
    if (action === "cron") {
      const secret = process.env.CRON_SECRET,
        auth = request.headers.get("authorization") ?? "";
      if (
        !secret ||
        auth.length !== secret.length + 7 ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(`Bearer ${secret}`))
      )
        fail("Unauthorized", 401);
      try {
        return response(await runIndexer());
      } finally {
        invalidateDiscovery();
      }
    }
  }
  if (request.method === "POST") {
    checkOrigin(request);
    await rateLimit(
      `request:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
      60,
    );
    const body = await jsonBody(request);
    if (action === "challenge")
      return response(await challenge(walletAddress(body.wallet)));
    if (action === "verify")
      return response(
        await verifyChallenge(string(body.id), string(body.signature)),
      );
    if (action === "logout") return response(await logout());
    const wallet = await requireWallet();
    if (action === "link-x")
      return response(await beginXLink(wallet, string(body.tokenId)));
    if (action === "buyer")
      return response(await verifyBuyer(wallet, string(body.tokenId)));
    if (action === "comment") return response(await postComment(wallet, body));
    if (action === "comment-delete")
      return response(await removeComment(wallet, string(body.id)));
    if (action === "setup")
      return response(await preparePoolConfig(wallet, string(body.symbol)));
    if (action === "image") {
      await rateLimit(`image:${wallet}`, 5);
      const data = Buffer.from(string(body.data), "base64");
      if (data.length > 280_000) fail("Choose an image under 280 KB.", 413);
      const png = data
        .subarray(0, 8)
        .equals(Buffer.from("89504e470d0a1a0a", "hex"));
      const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
      const webp =
        data.subarray(0, 4).toString() === "RIFF" &&
        data.subarray(8, 12).toString() === "WEBP";
      if (!png && !jpeg && !webp) fail("Choose a PNG, JPEG, or WebP image.");
      let optimized: Buffer;
      try {
        optimized = await sharp(data, { limitInputPixels: 16_000_000 })
          .rotate()
          .resize(512, 512, { fit: "cover" })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        return fail("Choose a valid PNG, JPEG, or WebP image.");
      }
      const [image] = await db
        .insert(tokenImages)
        .values({
          owner: wallet,
          data: Buffer.from(optimized).toString("base64"),
          contentType: "image/webp",
        })
        .returning();
      return response({ id: image.id });
    }
    if (action === "continue-launch")
      return response(await continueLaunch(wallet, string(body.id)));
    if (action === "launch") return response(await launch(wallet, body));
    if (action === "trade") return response(await trade(wallet, body));
    if (action === "claim") {
      if (
        body.venue !== undefined &&
        body.venue !== "dbc" &&
        body.venue !== "damm-v2"
      )
        fail("Invalid fee venue.");
      return response(
        await claim(
          wallet,
          string(body.tokenId),
          body.venue as string | undefined,
        ),
      );
    }
    if (action === "migrate")
      return response(await migrate(wallet, string(body.tokenId)));
    if (action === "review-wallet-fee")
      return response(
        await reviewChangedFee(
          wallet,
          string(body.id),
          string(body.transaction),
        ),
      );
    if (action === "submit")
      return response(
        await submit(wallet, string(body.id), string(body.transaction)),
      );
  }
  return fail("Not found.", 404);
}
async function route(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await context.params).path;
    const policy = publicPolicy(request, path);
    if (policy) {
      const data = await publicCache(policy.key, policy, async () => {
        // Applied only to origin work, not CDN/cache hits. Protect high-cardinality search abuse.
        if (redisRateLimitsEnabled())
          await rateLimit(
            `public-read:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
            180,
          );
        const result = await handle(request, path);
        if (!result.ok || result.headers.has("set-cookie"))
          throw new Error("Public cache rejected response");
        return result.json();
      });
      return Response.json(data, { headers: publicHeaders(policy.edge) });
    }
    return await handle(request, path);
  } catch (error) {
    if (error instanceof ProtocolError)
      return Response.json(
        { error: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    if (error instanceof LaunchError)
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            "Cache-Control": "no-store",
            ...(error.status === 429
              ? { "Retry-After": "60" }
              : error.status === 503
                ? { "Retry-After": "2" }
                : {}),
          },
        },
      );
    console.error(
      "Launchpad request failed",
      error instanceof Error ? error.message : "unknown",
    );
    if (
      error instanceof Error &&
      /\b429\b|too many requests|rate limits? exceeded/i.test(error.message)
    )
      return Response.json(
        {
          error:
            "The blockchain service is busy. Please try again in a minute.",
        },
        {
          status: 503,
          headers: { "Retry-After": "60", "Cache-Control": "no-store" },
        },
      );
    return Response.json(
      {
        error:
          "This request could not be completed. Check the connection and try again.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "2" },
      },
    );
  }
}
export const GET = route;
export const POST = route;
