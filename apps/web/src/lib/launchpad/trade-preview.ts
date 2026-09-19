import { Keypair } from "@solana/web3.js";
import { quoteAsset, quoteMultiplier, quoteSwap } from "@oneonly/protocol";
import {
  normalizeAmount,
  parseScaledUnits,
  formatScaledUnits,
  validateSlippage,
} from "@oneonly/core";
import { fail, string } from "./auth";
import { quoteRoutedSwap } from "./routed-trade";

// Jupiter /build requires a taker. Use an unfunded, disposable public address;
// discard its private key. Only numerical quotes leave this endpoint.
const previewAddress = Keypair.generate().publicKey.toBase58();
export async function tradePreview(
  token: {
    pool: string;
    quote: string;
    ticker: string;
    status: string;
    quoteDecimals?: number | null;
  },
  input: Record<string, unknown>,
) {
  if (!["active", "released"].includes(token.status))
    fail("This token is not trading yet.");
  if (input.side !== "buy" && input.side !== "sell")
    fail("Choose buy or sell.");
  const settlement = string(input.settlement),
    sell = input.side === "sell";
  quoteAsset(settlement);
  const amountText = normalizeAmount(string(input.amount));
  const slippage = validateSlippage(input.slippageBps);
  let output: string, minimumOutput: string, venue: string;
  if (settlement !== token.quote) {
    const result = await quoteRoutedSwap(previewAddress, token, {
      ...input,
      amount: amountText,
    });
    output = formatScaledUnits(
      sell ? result.route.out : result.poolQuote.out,
      sell ? result.settlement.decimals : 6,
      sell ? result.multiplier : 1,
    );
    minimumOutput = formatScaledUnits(
      sell ? result.route.minimumOut : result.poolQuote.minimumOut,
      sell ? result.settlement.decimals : 6,
      sell ? result.multiplier : 1,
    );
    venue = `Jupiter + ${result.poolQuote.venue}`;
  } else {
    const multiplier = await quoteMultiplier(token.quote),
      decimals = token.quoteDecimals ?? quoteAsset(token.quote).decimals;
    const amount = parseScaledUnits(
      amountText,
      sell ? 6 : decimals,
      sell ? 1 : multiplier,
    );
    const quote = await quoteSwap(token.pool, amount, sell, slippage);
    output = formatScaledUnits(
      quote.out,
      sell ? decimals : 6,
      sell ? multiplier : 1,
    );
    minimumOutput = formatScaledUnits(
      quote.minimumOut,
      sell ? decimals : 6,
      sell ? multiplier : 1,
    );
    venue = quote.venue;
  }
  return {
    output,
    minimumOutput,
    outputSymbol: sell ? settlement : token.ticker,
    venue,
    quotedAt: new Date().toISOString(),
  };
}
