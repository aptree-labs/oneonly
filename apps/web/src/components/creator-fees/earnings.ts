type EarnedBalance = {
  symbol: string;
  decimals: number;
  earnedAtomic?: string;
  totalEntitlementAtomic?: string;
  amountAtomic?: string;
  claimedAtomic?: string;
  pendingAtomic?: string;
};
export function earnedAtomic(balance: EarnedBalance) {
  return balance.earnedAtomic !== undefined
    ? BigInt(balance.earnedAtomic)
    : BigInt(
        balance.totalEntitlementAtomic ??
          String(
            BigInt(balance.amountAtomic || "0") +
              BigInt(balance.claimedAtomic || "0"),
          ),
      ) + BigInt(balance.pendingAtomic || "0");
}
export function earnedLabel(
  balances?: EarnedBalance[] | null,
  usd?: number | null,
) {
  if (usd != null && Number.isFinite(usd))
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(usd);
  if (!balances?.length) return "—";
  const positive = balances.filter((b) => earnedAtomic(b) > 0n);
  if (!positive.length) return "0";
  return positive
    .map(
      (b) =>
        `${(Number(earnedAtomic(b)) / 10 ** b.decimals).toLocaleString("en-US", { maximumFractionDigits: Math.min(b.decimals, 6) })} ${b.symbol}`,
    )
    .join(" · ");
}
