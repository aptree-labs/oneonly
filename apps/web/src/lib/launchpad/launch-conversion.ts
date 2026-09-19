import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  connection,
  jupiterRoute,
  routeLookupTables,
  quoteAsset,
  quoteProgram,
  QUOTE_MINTS,
  configuredPool,
  NETWORK,
} from "@oneonly/protocol";
import { parseUnits, formatUnits, formatScaledUnits } from "@oneonly/core";
import { fail } from "./auth";

/** Separate, reviewable conversion avoids forcing a large Jupiter route and mint creation into one packet. */
export async function launchConversion(
  wallet: string,
  data: { quote: string; initialBuy: string; slippageBps: number },
  reference: Record<string, number>,
  multiplier: number,
) {
  if (NETWORK !== "mainnet-beta")
    fail("SOL conversion is available on mainnet.");
  if (data.slippageBps < 20)
    fail("Use at least 0.2% total slippage for a two-step SOL launch.");
  await configuredPool(data.quote);
  const asset = quoteAsset(data.quote),
    amount = parseUnits(data.initialBuy, 9);
  const route = await jupiterRoute({
    wallet,
    inputMint: QUOTE_MINTS.SOL,
    outputMint: asset.mint,
    amount,
    inputProgram: await quoteProgram(new PublicKey(QUOTE_MINTS.SOL)),
    outputProgram: await quoteProgram(new PublicKey(asset.mint)),
    slippageBps: Math.floor(data.slippageBps / 2),
  });
  if (
    Number(formatUnits(route.minimumOut, asset.decimals)) *
      reference[data.quote] <
    5
  )
    fail(
      "Increase the SOL amount so the converted first buy is at least $5 after conversion and slippage.",
    );
  const rpc = connection(),
    latest = await rpc.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(wallet),
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ...route.setup,
        route.swap,
        ...route.cleanup,
      ],
    }).compileToV0Message(await routeLookupTables(rpc, route.lookupAddresses)),
  );
  if (transaction.serialize().length > 1232)
    fail("The conversion route is too large. Try again for another route.");
  const result = await rpc.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (result.value.err)
    fail(
      "The SOL conversion could not be simulated. Check your SOL balance, including network fees and account rent.",
      409,
    );
  return {
    transaction,
    quoteAmount: route.minimumOut.toString(),
    details: {
      action: `Step 1 of 2 · convert SOL to ${data.quote}`,
      input: `${formatUnits(amount, 9)} SOL`,
      minimumOutput: `${formatScaledUnits(route.minimumOut, asset.decimals, multiplier)} ${data.quote}`,
      slippage: `${data.slippageBps / 200}% for conversion; ${data.slippageBps / 200}% for the first buy`,
      nextStep:
        "After confirmation, review and sign the token launch. The ticker is claimed at that step. If you stop or launch fails, the converted asset stays in your wallet.",
    },
  };
}
