import { creatorRankings } from "@/lib/creator-fees/rankings";
import { displayReferences } from "@/lib/launchpad/discovery";
import { getDatabase } from "@oneonly/db";
import { NETWORK, quoteAssets } from "@oneonly/protocol";
import { after } from "next/server";
import { warmFeeSnapshots } from "@/lib/creator-fees/projections";
import {
  prepareCreatorFeeClaim,
  prepareCreatorFeeCollection,
  reconcileCreatorFeeClaim,
} from "@/lib/creator-fees/transactions";
import {
  feeStatus,
  feeFeatureEnabled,
  assertFeeFeature,
  findFeeProfile,
  feeDashboard,
  bindFeeWallet,
  feeRecipients,
  feeRecipient,
  createFeeChallenge,
  verifyFeeChallenge,
  FeeError,
} from "@/lib/creator-fees/service";
import {
  checkOrigin,
  jsonBody,
  requireWallet,
  rateLimit,
  string,
} from "@/lib/launchpad/auth";
import { LaunchError } from "@oneonly/core";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function route(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params,
      [action, id] = path,
      url = new URL(request.url);
    if (request.method === "GET" && action === "status") {
      if (feeFeatureEnabled())
        await rateLimit(
          `creator-fees:status:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"}`,
          30,
        );
      return response(await feeStatus());
    }
    assertFeeFeature();
    if (request.method === "GET") {
      const offset = Number(url.searchParams.get("offset") || 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
        throw new FeeError("Invalid page.");
      await rateLimit(
        `creator-fees:read:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
        30,
      );
      if (action === "leaderboard") {
        const sort = url.searchParams.get("sort") || "fees";
        if (sort !== "fees" && sort !== "tokens")
          throw new FeeError("Invalid creator sort.");
        after(async () => {
          await warmFeeSnapshots().catch(() => {});
        });
        const references = await displayReferences();
        const prices = Object.fromEntries(
          quoteAssets().flatMap((asset) => {
            const usd = references?.[asset.symbol];
            return usd && Number.isFinite(usd) && usd > 0
              ? [[asset.symbol, { mint: asset.mint, usd }]]
              : [];
          }),
        );
        return response(
          await creatorRankings(await getDatabase(), {
            network: NETWORK,
            query: url.searchParams.get("query") || "",
            offset,
            sort,
            prices,
          }),
        );
      }
      if (action === "profiles")
        return response({
          profiles: [await findFeeProfile(url.searchParams.get("q") ?? "")],
        });
      if (action === "recipients" && id)
        return response(
          await feeRecipient(
            id,
            undefined,
            offset,
            url.searchParams.get("profileOnly") === "true",
          ),
        );
      if (action === "recipients") {
        after(async () => {
          await warmFeeSnapshots().catch(() => {});
        });
        return response(
          await feeRecipients(url.searchParams.get("query") || "", offset),
        );
      }
      if (action === "me")
        return response(
          await feeDashboard(await requireWallet(), undefined, offset),
        );
    }
    if (request.method === "POST") {
      checkOrigin(request);
      const wallet = await requireWallet();
      await rateLimit(`creator-fees:write:${wallet}`, 10);
      const body = await jsonBody(request);
      if (action === "bind")
        return response({ binding: await bindFeeWallet(wallet) });
      if (action === "challenges")
        return response(
          await createFeeChallenge(wallet, {
            tokenId: string(body.tokenId),
            mint: string(body.mint),
            amountAtomic: string(body.amountAtomic),
          }),
        );
      if (action === "verify")
        return response(
          await verifyFeeChallenge(
            wallet,
            string(body.challengeId),
            string(body.tweetUrl),
          ),
        );
      if (action === "collect") {
        if (
          body.venue !== undefined &&
          body.venue !== "dbc" &&
          body.venue !== "damm-v2"
        )
          throw new FeeError("Choose a valid fee venue.");
        return response(
          await prepareCreatorFeeCollection(
            wallet,
            string(body.tokenId),
            body.venue,
          ),
        );
      }
      if (action === "claim")
        return response(
          await prepareCreatorFeeClaim(wallet, string(body.challengeId)),
        );
      if (action === "reconcile")
        return response(
          await reconcileCreatorFeeClaim(wallet, string(body.challengeId)),
        );
    }
    return response({ error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof FeeError || error instanceof LaunchError)
      return response(
        {
          error: error.message,
          ...(error instanceof FeeError && error.code
            ? { code: error.code }
            : {}),
        },
        error.status,
      );
    return response(
      {
        error:
          "Creator fees are temporarily unavailable. Please try again shortly.",
      },
      503,
    );
  }
}
export const GET = route;
export const POST = route;
