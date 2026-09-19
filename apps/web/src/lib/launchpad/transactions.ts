import { randomUUID } from "node:crypto";
import { resolveProjectLinks } from "./project-links";
import { Effect, Either } from "effect";
import bs58 from "bs58";
import {
  validateLaunch,
  formatUnits,
  parseUnits,
  parseScaledUnits,
  formatScaledUnits,
  validateSlippage,
} from "@oneonly/core";
import {
  getDatabase,
  launchTokens,
  tickerClaims,
  tokenImages,
  transactionIntents,
  and,
  eq,
  desc,
} from "@oneonly/db";
import {
  Keypair,
  PublicKey,
  connection,
  client,
  createLaunch,
  quoteSwap,
  buildSwap,
  buildClaim,
  buildDammClaim,
  buildMigration,
  quoteAsset,
  quoteMultiplier,
  quoteAssets,
  NETWORK,
  assertNetwork,
  decodeWalletTransaction,
  transactionMessage,
  verifyWalletTransaction,
  prepareTransactionWire,
  reviewWalletFeeChange,
  validateWalletFeeChange,
  hasWalletSafetyAssertions,
  isLegacyTransaction,
  type WalletTransaction,
} from "@oneonly/protocol";
import { fail, origin, string, rateLimit } from "./auth";
import { routedTrade } from "./routed-trade";
import { launchConversion } from "./launch-conversion";
import { prices } from "./price";
export async function tokenById(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail("Token not found.", 404);
  const [token] = await (
    await getDatabase()
  )
    .select()
    .from(launchTokens)
    .where(and(eq(launchTokens.id, id), eq(launchTokens.network, NETWORK)))
    .limit(1);
  return token ?? fail("Token not found.", 404);
}
export async function prepareIntent(
  wallet: string,
  kind: string,
  transaction: WalletTransaction,
  tokenId: string | null,
  details: Record<string, string>,
  signer?: Keypair | Keypair[],
  continuation?: Record<string, string | number>,
) {
  await assertNetwork();
  const latest = await connection().getLatestBlockhash("confirmed");
  const { wire, message, priorityFeeLamports } = prepareTransactionWire(
    transaction,
    wallet,
    latest.blockhash,
    signer ? (Array.isArray(signer) ? signer : [signer]) : [],
  );
  const reviewDetails = {
    network: NETWORK,
    ...details,
    ...(priorityFeeLamports === null
      ? {}
      : { priorityFee: `${formatUnits(priorityFeeLamports, 9)} SOL` }),
  };
  const db = await getDatabase();
  const [intent] = await db
    .insert(transactionIntents)
    .values({
      wallet,
      network: NETWORK,
      kind,
      tokenId,
      transaction: wire,
      message,
      ...latest,
      details: reviewDetails,
      continuation,
    })
    .returning();
  return {
    id: intent.id,
    transaction: wire,
    details: reviewDetails,
    tokenId,
    status: intent.status,
    kind,
  };
}
export async function launch(
  wallet: string,
  input: unknown,
  rawConvertedAmount?: bigint,
) {
  await rateLimit(`launch:${wallet}`, 3);
  const validated = await Effect.runPromise(
    Effect.either(validateLaunch(input)),
  );
  if (Either.isLeft(validated)) throw validated.left;
  const data = validated.right,
    db = await getDatabase();
  const projectLinks = await resolveProjectLinks(wallet, data);
  const [image] = await db
    .select({ id: tokenImages.id })
    .from(tokenImages)
    .where(
      and(eq(tokenImages.id, data.imageId), eq(tokenImages.owner, wallet)),
    );
  if (!image) fail("Upload your token image first.");
  if (!quoteAssets().some((asset) => asset.symbol === data.quote))
    fail("Choose a supported quote asset.");
  const hasFirstBuy = data.initialBuy !== "0",
    reference = hasFirstBuy ? await prices() : null,
    asset = quoteAsset(data.quote),
    multiplier = hasFirstBuy ? await quoteMultiplier(data.quote) : 1,
    amount = !hasFirstBuy
      ? 0n
      : (rawConvertedAmount ??
        (data.payment === "SOL"
          ? parseUnits(data.initialBuy, 9)
          : parseScaledUnits(data.initialBuy, asset.decimals, multiplier)));
  if (hasFirstBuy && !reference?.[data.quote])
    fail(
      "A current USD reference for this asset is unavailable. Try again later.",
      503,
    );
  if (
    hasFirstBuy &&
    data.payment === "SOL" &&
    data.quote !== "SOL" &&
    rawConvertedAmount === undefined
  ) {
    const [claimed] = await db
      .select()
      .from(tickerClaims)
      .where(
        and(
          eq(tickerClaims.network, NETWORK),
          eq(tickerClaims.ticker, data.ticker),
        ),
      );
    if (claimed)
      fail(
        "That ticker is already claimed. Choose another before converting SOL.",
        409,
      );
    const conversion = await launchConversion(
      wallet,
      data,
      reference!,
      multiplier,
    );
    return prepareIntent(
      wallet,
      "launch-conversion",
      conversion.transaction,
      null,
      { ticker: data.ticker, ...conversion.details },
      undefined,
      {
        ...data,
        rawConvertedAmount: conversion.quoteAmount,
        slippageBps: Math.floor(data.slippageBps / 2),
      },
    );
  }
  if (
    hasFirstBuy &&
    Number(formatUnits(amount, asset.decimals)) * reference![data.quote] < 5
  )
    fail(
      `Your first buy must be at least $5 in ${data.quote}, plus network fees.`,
    );
  const id = randomUUID(),
    mint = Keypair.generate();
  const built = await createLaunch({
    wallet,
    mint,
    quote: data.quote,
    name: data.name,
    ticker: data.ticker,
    uri: `${origin()}/api/launchpad/metadata/${id}`,
    amount,
    slippageBps: data.slippageBps,
  });
  // The uniqueness constraint is the authority, not a previous availability response.
  const reserved = await db.transaction(async (tx) => {
    await tx.insert(launchTokens).values({
      id,
      network: NETWORK,
      ticker: data.ticker,
      name: data.name,
      description: data.description,
      projectLinks,
      imageId: data.imageId,
      creator: wallet,
      quote: data.quote,
      quoteMint: asset.mint,
      quoteDecimals: asset.decimals,
      quoteCategory: asset.category,
      mint: mint.publicKey.toBase58(),
      pool: built.pool,
      config: built.config,
    });
    const claims = await tx
      .insert(tickerClaims)
      .values({ network: NETWORK, ticker: data.ticker, tokenId: id })
      .onConflictDoNothing()
      .returning();
    if (!claims.length) {
      await tx.delete(launchTokens).where(eq(launchTokens.id, id));
      return false;
    }
    return true;
  });
  if (!reserved) fail("That ticker is already claimed. Choose another.", 409);
  try {
    return await prepareIntent(
      wallet,
      "launch",
      built.transaction,
      id,
      {
        ticker: data.ticker,
        ...(hasFirstBuy
          ? {
              input: `${formatScaledUnits(amount, asset.decimals, multiplier)} ${data.quote}`,
              minimumOutput: `${formatUnits(built.minimumOut, 6)} ${data.ticker}`,
              slippage: `${data.slippageBps / 100}%`,
              priceReference: new Date(reference!.timestamp).toISOString(),
            }
          : {
              firstBuy:
                "None — anyone can make the first purchase after launch",
              costs: "Creation rent and network fees are paid in SOL",
            }),
      },
      mint,
    );
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx.delete(tickerClaims).where(eq(tickerClaims.tokenId, id));
      await tx.delete(launchTokens).where(eq(launchTokens.id, id));
    });
    throw error;
  }
}
export async function continueLaunch(wallet: string, id: string) {
  await reconcile(id, wallet);
  const funding = await intentForWallet(id, wallet);
  if (
    funding.kind !== "launch-conversion" ||
    funding.status !== "confirmed" ||
    !funding.continuation
  )
    fail("Wait for your SOL conversion to confirm before continuing.", 409);
  if (funding.continuationResult)
    return intentForWallet(funding.continuationResult, wallet);
  const data = funding.continuation!;
  const next = await launch(
    wallet,
    { ...data, payment: data.quote },
    BigInt(string(data.rawConvertedAmount)),
  );
  await (
    await getDatabase()
  )
    .update(transactionIntents)
    .set({ continuationResult: next.id })
    .where(eq(transactionIntents.id, id));
  return next;
}
export async function trade(wallet: string, input: Record<string, unknown>) {
  await rateLimit(`trade:${wallet}`);
  const token = await tokenById(string(input.tokenId));
  if (token.status === "draft") fail("This token has not launched yet.");
  if (input.side !== "buy" && input.side !== "sell")
    fail("Choose buy or sell.");
  const settlement =
    input.settlement === undefined ? token.quote : string(input.settlement);
  quoteAsset(settlement);
  if (settlement !== token.quote) {
    const routed = await routedTrade(wallet, token, input);
    return prepareIntent(wallet, "trade", routed.transaction, token.id, {
      ...routed.details,
      ticker: token.ticker,
    });
  }
  const sell = input.side === "sell",
    multiplier = await quoteMultiplier(token.quote),
    amount = parseScaledUnits(
      string(input.amount),
      sell ? 6 : (token.quoteDecimals ?? quoteAsset(token.quote).decimals),
      sell ? 1 : multiplier,
    ),
    slippage = validateSlippage(input.slippageBps);
  const quote = await quoteSwap(token.pool, amount, sell, slippage);
  const transaction = await buildSwap({
    wallet,
    pool: token.pool,
    amount,
    sell,
    minimumOut: quote.minimumOut,
    venue: quote.venue,
  });
  return prepareIntent(wallet, "trade", transaction, token.id, {
    ticker: token.ticker,
    venue:
      quote.venue === "damm-v2" ? "Meteora DAMM v2" : "Meteora bonding curve",
    pool: quote.pool,
    side: sell ? "sell" : "buy",
    input: `${input.amount} ${sell ? token.ticker : token.quote}`,
    estimatedSpend: `${formatScaledUnits(quote.consumedInput, sell ? 6 : (token.quoteDecimals ?? quoteAsset(token.quote).decimals), sell ? 1 : multiplier)} ${sell ? token.ticker : token.quote}`,
    expectedOutput: `${formatScaledUnits(quote.out, sell ? (token.quoteDecimals ?? quoteAsset(token.quote).decimals) : 6, sell ? multiplier : 1)} ${sell ? token.quote : token.ticker}`,
    minimumOutput: `${formatScaledUnits(quote.minimumOut, sell ? (token.quoteDecimals ?? quoteAsset(token.quote).decimals) : 6, sell ? multiplier : 1)} ${sell ? token.quote : token.ticker}`,
    slippage: `${slippage / 100}%`,
  });
}
export async function claim(wallet: string, id: string, venue = "dbc") {
  await assertNetwork();
  const token = await tokenById(id);
  if (token.creator !== wallet)
    fail("Only the creator can claim these fees.", 403);
  return prepareIntent(
    wallet,
    "claim",
    venue === "damm-v2"
      ? await buildDammClaim(token.pool, wallet)
      : await buildClaim(token.pool, wallet),
    id,
    {
      ticker: token.ticker,
      claimVenue: venue === "damm-v2" ? "damm-v2" : "dbc",
      action:
        venue === "damm-v2"
          ? "Claim graduated liquidity position fees"
          : "Claim available curve creator fees",
    },
  );
}
export async function migrate(wallet: string, id: string) {
  await rateLimit(`migrate:${wallet}`, 3);
  const token = await tokenById(id);
  if (!["active", "released"].includes(token.status))
    fail("This token has not launched yet.");
  const built = await buildMigration(token.pool, wallet);
  return prepareIntent(
    wallet,
    "migrate",
    built.transaction,
    id,
    {
      ticker: token.ticker,
      action: "Graduate this curve into Meteora DAMM v2",
      networkCosts:
        "You pay the network fee and pool / position account rent in SOL.",
    },
    [built.firstPositionNftKeypair, built.secondPositionNftKeypair],
  );
}
export async function intentForWallet(id: string, wallet: string) {
  const [intent] = await (
    await getDatabase()
  )
    .select()
    .from(transactionIntents)
    .where(
      and(
        eq(transactionIntents.id, id),
        eq(transactionIntents.wallet, wallet),
        eq(transactionIntents.network, NETWORK),
      ),
    );
  return intent ?? fail("Transaction not found.", 404);
}
export async function reconcile(
  id: string,
  wallet: string,
  rebroadcast = true,
) {
  const db = await getDatabase(),
    intent = await intentForWallet(id, wallet),
    rpc = connection();
  if (
    intent.status === "confirmed" ||
    intent.status === "failed" ||
    intent.status === "expired"
  )
    return {
      id,
      status: intent.status,
      signature: intent.signature,
      tokenId: intent.tokenId,
      error: intent.error,
    };
  await assertNetwork();
  let absentFromChain = false;
  if (intent.signature) {
    const status = (
      await rpc.getSignatureStatuses([intent.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    absentFromChain = !status;
    if (status?.err) {
      if (intent.kind === "launch" && intent.tokenId) {
        const token = await tokenById(intent.tokenId);
        if (!(await rpc.getAccountInfo(new PublicKey(token.pool))))
          await db.transaction(async (tx) => {
            await tx
              .delete(tickerClaims)
              .where(eq(tickerClaims.tokenId, token.id));
            await tx
              .update(launchTokens)
              .set({ status: "failed" })
              .where(eq(launchTokens.id, token.id));
          });
      }
      await db
        .update(transactionIntents)
        .set({
          status: "failed",
          error: "Transaction failed on-chain. No trade was executed.",
        })
        .where(eq(transactionIntents.id, id));
      return {
        id,
        status: "failed",
        error: "Transaction failed on-chain. No trade was executed.",
        signature: intent.signature,
      };
    }
    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      if (intent.kind === "launch" && intent.tokenId) {
        const token = await tokenById(intent.tokenId),
          pool = await client().state.getPool(token.pool);
        if (
          !pool ||
          pool.poolState.creator.toBase58() !== wallet ||
          pool.poolState.baseMint.toBase58() !== token.mint ||
          pool.poolState.config.toBase58() !== token.config
        )
          fail("Waiting for verified pool state.", 503);
        await db
          .update(launchTokens)
          .set({
            status: "active",
            activatedAt: new Date(),
            launchSignature: intent.signature,
          })
          .where(eq(launchTokens.id, token.id));
      }
      await db
        .update(transactionIntents)
        .set({ status: "confirmed" })
        .where(eq(transactionIntents.id, id));
      return {
        id,
        status: "confirmed",
        signature: intent.signature,
        tokenId: intent.tokenId,
      };
    }
  }
  if ((await rpc.getBlockHeight("confirmed")) > intent.lastValidBlockHeight) {
    // An ambiguous broadcast remains reserved if the pool exists, regardless of RPC history availability.
    if (intent.kind === "launch" && intent.tokenId) {
      const token = await tokenById(intent.tokenId);
      if (await rpc.getAccountInfo(new PublicKey(token.pool)))
        return {
          id,
          status: "submitted",
          signature: intent.signature,
          tokenId: intent.tokenId,
        };
    }
    await db.transaction(async (tx) => {
      await tx
        .update(transactionIntents)
        .set({ status: "expired" })
        .where(eq(transactionIntents.id, id));
      if (intent.kind === "launch" && intent.tokenId) {
        await tx
          .delete(tickerClaims)
          .where(eq(tickerClaims.tokenId, intent.tokenId));
        await tx
          .update(launchTokens)
          .set({ status: "expired" })
          .where(eq(launchTokens.id, intent.tokenId));
      }
    });
    return {
      id,
      status: "expired",
      tokenId: intent.tokenId,
      error: "Transaction expired. Prepare it again.",
    };
  }
  if (
    rebroadcast &&
    intent.status === "submitted" &&
    intent.signature &&
    absentFromChain
  ) {
    // Resend the exact signed bytes while their blockhash is valid. The same
    // signature cannot execute twice; never create a new transaction here.
    try {
      await rpc.sendRawTransaction(Buffer.from(intent.transaction, "base64"), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
    } catch {
      // A transport failure is ambiguous. Keep polling the original signature.
    }
  }
  return {
    id,
    status: intent.status,
    signature: intent.signature,
    tokenId: intent.tokenId,
  };
}
export async function submit(wallet: string, id: string, wire: string) {
  const db = await getDatabase(),
    intent = await intentForWallet(id, wallet);
  if (intent.status !== "prepared") return reconcile(id, wallet, false);
  let transaction: WalletTransaction;
  try {
    transaction = decodeWalletTransaction(wire);
  } catch {
    return fail(
      "The wallet returned an unreadable transaction. Reconnect and request a fresh review.",
    );
  }
  if (transactionMessage(transaction).toString("base64") !== intent.message) {
    // Wallet approval covers its bounded priority fee; all trade effects remain identical.
    if (!["trade", "claim"].includes(intent.kind))
      fail(
        "Your wallet changed the reviewed transaction. Request a fresh review.",
        409,
      );
    try {
      let baseline = intent.transaction;
      // Older clients persisted Phantom postconditions during fee re-review.
      // Rebuild ONLY claims from trusted pool/creator data instead of treating
      // wallet-generated balance assertions as application instructions.
      if (intent.kind === "claim" && hasWalletSafetyAssertions(baseline)) {
        const tokenId = intent.tokenId ?? fail("Claim token is missing.", 409);
        const token = await tokenById(tokenId);
        if (token.creator !== wallet)
          fail("Only the creator can claim these fees.", 403);
        const graduated =
          intent.details.claimVenue === "damm-v2" ||
          intent.details.action === "Claim graduated liquidity position fees";
        const clean = graduated
          ? await buildDammClaim(token.pool, wallet)
          : await buildClaim(token.pool, wallet);
        baseline = prepareTransactionWire(clean, wallet, intent.blockhash).wire;
      }
      validateWalletFeeChange(baseline, wire);
    } catch (error) {
      console.warn("wallet-transaction-rejected", {
        intentId: id,
        reason: error instanceof Error ? error.message : "Transaction changed.",
      });
      fail(
        error instanceof Error ? error.message : "Transaction changed.",
        409,
      );
    }
  }
  if (!verifyWalletTransaction(transaction))
    fail(
      "The wallet signature is missing or invalid. Reconnect your wallet and request a fresh review.",
    );
  await assertNetwork();
  if (
    (await connection().getBlockHeight("confirmed")) >
    intent.lastValidBlockHeight
  )
    return reconcile(id, wallet);
  const signature = bs58.encode(
    isLegacyTransaction(transaction)
      ? transaction.signature!
      : transaction.signatures[0],
  );
  // Persist before broadcast; clients can recover an unknown network outcome safely.
  const claimed = await db
    .update(transactionIntents)
    .set({
      signature,
      status: "submitted",
      // Purchase proofs compare the finalized message with this receipt. Keep
      // the validated wallet-approved fee edits, not the earlier unsigned quote.
      message: transactionMessage(transaction).toString("base64"),
      transaction: Buffer.from(transaction.serialize()).toString("base64"),
    })
    .where(
      and(
        eq(transactionIntents.id, id),
        eq(transactionIntents.status, "prepared"),
      ),
    )
    .returning();
  if (!claimed.length) return reconcile(id, wallet, false);
  try {
    await connection().sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  } catch {
    /* Poll the deterministic signature rather than inviting a duplicate purchase. */
  }
  return { id, status: "submitted", signature, tokenId: intent.tokenId };
}
export async function recentIntents(wallet: string) {
  return (await getDatabase())
    .select({
      id: transactionIntents.id,
      status: transactionIntents.status,
      kind: transactionIntents.kind,
      tokenId: transactionIntents.tokenId,
      signature: transactionIntents.signature,
      createdAt: transactionIntents.createdAt,
      details: transactionIntents.details,
    })
    .from(transactionIntents)
    .where(
      and(
        eq(transactionIntents.wallet, wallet),
        eq(transactionIntents.network, NETWORK),
      ),
    )
    .orderBy(desc(transactionIntents.createdAt))
    .limit(30);
}

export async function reviewChangedFee(
  wallet: string,
  id: string,
  wire: string,
) {
  await rateLimit(`wallet-fee:${wallet}`, 8);
  const intent = await intentForWallet(id, wallet);
  // A cached client can still request the old second review. Its wallet has
  // already approved these exact bytes. Use the same strict submit path and
  // never freeze Phantom assertions into the next unsigned claim/trade.
  if (["claim", "trade"].includes(intent.kind)) {
    const result = await submit(wallet, id, wire);
    return { ...result, kind: intent.kind, details: intent.details };
  }
  if (intent.status !== "prepared")
    return fail("This transaction is already submitted or expired.", 409);
  if (
    (await connection().getBlockHeight("confirmed")) >
    intent.lastValidBlockHeight
  )
    return fail(
      "Quote expired. Close this review and request a fresh quote.",
      409,
    );
  let revised;
  try {
    revised = reviewWalletFeeChange(intent.transaction, wire);
  } catch (error) {
    return fail((error as Error).message, 409);
  }
  const details = {
    ...intent.details,
    priorityFee: `${formatUnits(revised.priorityFeeLamports, 9)} SOL`,
  };
  const [updated] = await (
    await getDatabase()
  )
    .update(transactionIntents)
    .set({ transaction: revised.wire, message: revised.message, details })
    .where(
      and(
        eq(transactionIntents.id, id),
        eq(transactionIntents.wallet, wallet),
        eq(transactionIntents.status, "prepared"),
        eq(transactionIntents.message, intent.message),
      ),
    )
    .returning();
  if (!updated)
    return fail("Review changed in another tab. Request a fresh quote.", 409);
  return {
    id,
    kind: intent.kind,
    status: "prepared",
    transaction: revised.wire,
    details,
    tokenId: intent.tokenId,
  };
}
