import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  connection,
  assertNetwork,
  NETWORK,
  quoteSwap,
  buildSwap,
  quoteAsset,
  quoteMintInfo,
  jupiterRoute,
  routeLookupTables,
  quoteProgram,
  QUOTE_MINTS,
  quoteMultiplier,
  intermediateSolInstructions,
} from "@oneonly/protocol";
import {
  parseScaledUnits,
  formatScaledUnits,
  validateSlippage,
} from "@oneonly/core";
import { fail, string } from "./auth";

/** Shared quote math for previews and executable reviews. Never signs or submits. */
export async function quoteRoutedSwap(
  wallet: string,
  token: { pool: string; quote: string; ticker: string },
  input: Record<string, unknown>,
) {
  if (NETWORK !== "mainnet-beta")
    fail("Asset conversion is only available on mainnet.");
  await assertNetwork();
  const sell = input.side === "sell",
    asset = quoteAsset(token.quote),
    settlement = quoteAsset(string(input.settlement)),
    quoteMint = new PublicKey(asset.mint);
  if (settlement.mint === asset.mint)
    fail("Use the direct pool route for this asset.");
  await Promise.all([
    quoteMintInfo(quoteMint),
    quoteMintInfo(new PublicKey(settlement.mint)),
  ]);
  const multiplier = await quoteMultiplier(settlement.symbol);
  const amount = parseScaledUnits(
    string(input.amount),
    sell ? 6 : settlement.decimals,
    sell ? 1 : multiplier,
  );
  const tolerance = validateSlippage(input.slippageBps),
    legSlippage = Math.floor(tolerance / 2);
  const mintProgram = await quoteProgram(quoteMint),
    settlementProgram = await quoteProgram(new PublicKey(settlement.mint));
  const initialPoolQuote = sell
    ? await quoteSwap(token.pool, amount, true, legSlippage)
    : null;
  const route = await jupiterRoute({
    wallet,
    inputMint: sell ? asset.mint : settlement.mint,
    outputMint: sell ? settlement.mint : asset.mint,
    inputProgram: sell ? mintProgram : settlementProgram,
    outputProgram: sell ? settlementProgram : mintProgram,
    amount: sell ? BigInt(initialPoolQuote!.minimumOut) : amount,
    slippageBps: legSlippage,
  });
  const poolAmount = sell ? amount : route.minimumOut;
  const poolQuote =
    initialPoolQuote ??
    (await quoteSwap(token.pool, poolAmount, false, legSlippage));
  return {
    sell,
    asset,
    settlement,
    multiplier,
    amount,
    tolerance,
    route,
    poolAmount,
    poolQuote,
  };
}

/** Two swaps in one transaction; a failed conversion or pool trade reverts both legs. */
export async function routedTrade(
  wallet: string,
  token: { pool: string; quote: string; ticker: string },
  input: Record<string, unknown>,
) {
  const {
    sell,
    asset,
    settlement,
    multiplier,
    tolerance,
    route,
    poolAmount,
    poolQuote,
  } = await quoteRoutedSwap(wallet, token, input);
  const poolTx = await buildSwap({
    wallet,
    pool: token.pool,
    amount: poolAmount,
    sell,
    minimumOut: poolQuote.minimumOut,
    venue: poolQuote.venue,
  });
  const nativeIntermediate = asset.mint === QUOTE_MINTS.SOL;
  const poolInstructions = nativeIntermediate
    ? intermediateSolInstructions(poolTx.instructions, wallet)
    : poolTx.instructions;
  const routeSetup =
    nativeIntermediate && sell
      ? intermediateSolInstructions(route.setup, wallet)
      : route.setup;
  const instructions = [
    ...routeSetup,
    ...(sell ? poolInstructions : [route.swap]),
    ...(sell ? [route.swap] : poolInstructions),
    ...route.cleanup,
  ].filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  const rpc = connection(),
    latest = await rpc.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(wallet),
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ...instructions,
      ],
    }).compileToV0Message(await routeLookupTables(rpc, route.lookupAddresses)),
  );
  if (transaction.serialize().length > 1232)
    fail(
      "This route is too large. Try a smaller trade or use the pool’s quote asset.",
    );
  const simulation = await rpc.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (simulation.value.err)
    fail(
      "This route could not be simulated. Check your balances and SOL for network costs, or request a fresh quote.",
      409,
    );
  return {
    transaction,
    details: {
      side: sell ? "sell" : "buy",
      input: `${input.amount} ${sell ? token.ticker : settlement.symbol}`,
      venue: `Jupiter + ${poolQuote.venue === "dbc" ? "Meteora bonding curve" : "Meteora DAMM v2"}`,
      expectedOutput: `${formatScaledUnits(sell ? route.out : poolQuote.out, sell ? settlement.decimals : 6, sell ? multiplier : 1)} ${sell ? settlement.symbol : token.ticker}`,
      minimumOutput: `${formatScaledUnits(sell ? route.minimumOut : poolQuote.minimumOut, sell ? settlement.decimals : 6, sell ? multiplier : 1)} ${sell ? settlement.symbol : token.ticker}`,
      slippage: `${tolerance / 100}% maximum across both swaps`,
      conversionBalance: `Any unused ${token.quote} from the conversion stays in your wallet.`,
      networkCosts:
        "SOL transaction fees and any new token account rent apply.",
    },
  };
}
