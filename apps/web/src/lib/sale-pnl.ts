import { parseUnits, formatUnits } from "@oneonly/core";

export type SaleShare = {
  status: "ready" | "pending" | "unavailable";
  wallet: string;
  signature: string;
  quote: string;
  quantity: string | null;
  proceeds: string | null;
  costBasis: string | null;
  pnl: string | null;
  percent: number | null;
  reason?: string;
};
export type CostTrade = {
  signature: string;
  side: string;
  baseAmount: string;
  quoteAmount: string;
  blockTime: Date;
};

/** Average acquisition cost of just the units sold, using exact token integers. */
export function saleCostBasis(
  trades: CostTrade[],
  sale: {
    signature: string;
    quantity: bigint;
    preBalance: bigint;
    quoteDecimals: number;
  },
): bigint | null {
  let position = 0n,
    cost = 0n;
  // The index has second-resolution timestamps, not transaction order in a slot.
  // Do not invent an order when a buy and sell occurred in the same second.
  const seconds = new Map<number, { side: string; signature: string }>();
  for (const trade of trades) {
    const previous = seconds.get(trade.blockTime.getTime());
    if (
      previous &&
      previous.side !== trade.side &&
      previous.signature !== trade.signature
    )
      return null;
    seconds.set(trade.blockTime.getTime(), trade);
  }
  try {
    for (const trade of trades) {
      if (trade.signature === sale.signature) {
        if (
          trade.side !== "sell" ||
          position !== sale.preBalance ||
          sale.quantity <= 0n ||
          position < sale.quantity ||
          parseUnits(trade.baseAmount, 6) !== sale.quantity
        )
          return null;
        return (cost * sale.quantity) / position;
      }
      const amount = parseUnits(trade.baseAmount, 6);
      const quote = parseUnits(trade.quoteAmount, sale.quoteDecimals);
      if (amount <= 0n || quote < 0n) return null;
      if (trade.side === "buy") {
        position += amount;
        cost += quote;
      } else if (trade.side === "sell" && amount <= position) {
        cost -= (cost * amount) / position;
        position -= amount;
      } else return null;
    }
  } catch {
    return null;
  }
  return null;
}

export function saleReturn(proceeds: bigint, cost: bigint, decimals: number) {
  const pnl = proceeds - cost;
  return {
    costBasis: formatUnits(cost, decimals),
    pnl: `${pnl < 0n ? "-" : ""}${formatUnits(pnl < 0n ? -pnl : pnl, decimals)}`,
    percent: cost > 0n ? Number((pnl * 10000n) / cost) / 100 : null,
  };
}
