import {
  NETWORK,
  assertNetwork,
  client,
  defaultCurve,
  Keypair,
  PublicKey,
  quoteAsset,
  quoteAssets,
  MAINNET_STOCKS,
  inspectStockSetup,
  connection,
  MAINNET_TOKENS,
  tokenSetupThreshold,
  quoteMintInfo,
  configuredPool,
} from "@oneonly/protocol";
import { formatUnits } from "@oneonly/core";
import {
  getDatabase,
  transactionIntents,
  and,
  eq,
  desc,
  isNull,
} from "@oneonly/db";
import { fail, rateLimit } from "./auth";
import { prepareIntent, reconcile } from "./transactions";
import { prices } from "./price";

/** The owner signs config creation in their wallet. The server never holds a spending key. */
export async function preparePoolConfig(wallet: string, symbol: string) {
  if (NETWORK !== "mainnet-beta")
    return fail("Mainnet setup is unavailable on this network.");
  const receiver = process.env.ONEONLY_FEE_WALLET;
  if (!receiver || wallet !== receiver)
    return fail("Connect the configured platform owner wallet.", 403);
  const stock = MAINNET_STOCKS.find((asset) => asset.symbol === symbol);
  const token = MAINNET_TOKENS.find((asset) => asset.symbol === symbol);
  if (symbol !== "SOL" && symbol !== "USDC" && !stock && !token)
    return fail("This pair is not ready for setup.");
  await rateLimit(`setup:${wallet}`, 20);
  await assertNetwork();
  // Setup has its own allowlist. Pending stock configs must not bypass the trading gate.
  const asset = stock
    ? quoteAssets().find((asset) => asset.symbol === symbol)!
    : quoteAsset(symbol);
  if (asset.config && asset.launchTokenType === 1)
    return fail("Token-2022 is already configured for this pair.");
  const kind = `setup-token2022-${symbol}`;
  const db = await getDatabase();
  const [previous] = await db
    .select()
    .from(transactionIntents)
    .where(
      and(
        eq(transactionIntents.wallet, wallet),
        eq(transactionIntents.network, NETWORK),
        eq(transactionIntents.kind, kind),
      ),
    )
    .orderBy(desc(transactionIntents.createdAt))
    .limit(1);
  if (previous) {
    const state = await reconcile(previous.id, wallet);
    const nearlyExpired =
      state.status === "prepared" &&
      !previous.signature &&
      previous.lastValidBlockHeight -
        (await connection().getBlockHeight("confirmed")) <
        100;
    if (nearlyExpired) {
      // No spending signature is retained for these generated config keys.
      // Retire only an unsubmitted review, then build a fresh, partially signed
      // configuration. Never replace an ambiguous submitted transaction.
      const retired = await db
        .update(transactionIntents)
        .set({ status: "expired" })
        .where(
          and(
            eq(transactionIntents.id, previous.id),
            eq(transactionIntents.status, "prepared"),
            isNull(transactionIntents.signature),
          ),
        )
        .returning();
      if (!retired.length)
        return {
          ...(await reconcile(previous.id, wallet)),
          kind,
          details: previous.details,
          transaction: undefined,
        };
    } else if (!["expired", "failed"].includes(state.status)) {
      return {
        ...state,
        kind,
        details: previous.details,
        transaction:
          state.status === "prepared" ? previous.transaction : undefined,
      };
    }
  }
  const config = Keypair.generate();
  const owner = new PublicKey(receiver);
  const stockInfo = stock
    ? await inspectStockSetup(connection(), symbol)
    : null;
  const existing = asset.config ? (await configuredPool(symbol)).config : null;
  const reference = token && !existing ? await prices() : null;
  const threshold = existing
    ? Number(
        formatUnits(
          BigInt(existing.migrationQuoteThreshold.toString()),
          asset.decimals,
        ),
      )
    : token
      ? tokenSetupThreshold(symbol, reference![symbol])
      : undefined;
  if (token) {
    const mint = await quoteMintInfo(new PublicKey(token.mint));
    if (
      mint.decimals !== token.decimals ||
      mint.mintAuthority ||
      mint.freezeAuthority
    )
      return fail(
        "The quote mint no longer matches the verified token configuration.",
        503,
      );
  }
  const curve = defaultCurve(symbol, threshold, NETWORK);
  if (
    existing &&
    (!curve.migrationQuoteThreshold.eq(existing.migrationQuoteThreshold) ||
      !curve.sqrtStartPrice.eq(existing.sqrtStartPrice) ||
      JSON.stringify(
        curve.curve
          .filter((point) => !point.liquidity.isZero())
          .map((point) => [
            point.sqrtPrice.toString(),
            point.liquidity.toString(),
          ]),
      ) !==
        JSON.stringify(
          existing.curve
            .filter((point) => !point.liquidity.isZero())
            .map((point) => [
              point.sqrtPrice.toString(),
              point.liquidity.toString(),
            ]),
        ))
  )
    return fail(
      "The replacement must preserve the exact curve and graduation threshold.",
      409,
    );
  const transaction = await client().partner.createConfig({
    ...curve,
    payer: owner,
    config: config.publicKey,
    feeClaimer: owner,
    leftoverReceiver: owner,
    quoteMint: new PublicKey(asset.mint),
    ...(stockInfo ? { tokenBadge: stockInfo.badge } : {}),
  });
  return prepareIntent(
    wallet,
    kind,
    transaction,
    null,
    {
      action: `Create ${symbol} Token-2022 launch configuration`,
      tokenProgram: "Token-2022 · immutable metadata · fixed supply",
      replacesConfig: asset.config || "New pair",
      deploymentVariable: `DBC_CONFIG_TOKEN2022_${symbol}`,
      quoteMint: asset.mint,
      configAddress: config.publicKey.toBase58(),
      feeReceiver: receiver,
      leftoverReceiver: receiver,
      curveFee: "1.25% total: 0.25% Meteora, 0.5% creator, 0.5% OneOnly",
      graduatedPoolFee:
        "1.25% trading fee; creator/platform permanently locked liquidity split 50/50",
      graduationThreshold: existing
        ? `${formatUnits(BigInt(existing.migrationQuoteThreshold.toString()), asset.decimals)} ${symbol}${stockInfo ? " (unscaled)" : ""}. Unchanged from the current configuration.`
        : stockInfo
          ? `${stockInfo.stock.setupThreshold} unscaled ${symbol} tokens (${(stockInfo.stock.setupThreshold * stockInfo.multiplier).toFixed(8)} displayed tokens at the current multiplier). Fixed token amount, not a fixed USD value.`
          : token
            ? `${threshold!.toLocaleString("en-US")} ${symbol}. Fixed token quantity, approximately $${token.setupTargetUsd.toLocaleString("en-US")} at preparation; USD value changes with the token price.`
            : symbol === "SOL"
              ? "85 SOL"
              : "10,000 USDC",
      ...(reference
        ? {
            referenceUsdPrice: String(reference[symbol]),
            referenceTime: new Date(reference.timestamp).toISOString(),
          }
        : {}),
      ...(stockInfo
        ? {
            stockIssuer:
              "The issuer retains freeze, pause, permanent-delegate and scaling authorities.",
            tokenDecimals: String(stockInfo.stock.decimals),
            tokenBadge: stockInfo.badge.toBase58(),
            migrationTokenBadge: stockInfo.dammBadge.toBase58(),
          }
        : {}),
      networkCosts:
        "Config account rent and network fee, paid once in SOL; review in your wallet",
    },
    config,
  );
}
