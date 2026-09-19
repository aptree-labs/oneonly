/** Display only: never use these rounded values to build transactions. */
export function formatNumber(
  value: string | number | null | undefined,
): string {
  if (value == null || (typeof value === "string" && !value.trim())) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const magnitude = Math.abs(amount);
  if (magnitude >= 1_000)
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(amount);
  return new Intl.NumberFormat(
    "en-US",
    magnitude > 0 && magnitude < 1
      ? { maximumSignificantDigits: 4 }
      : { maximumFractionDigits: 2 },
  ).format(amount);
}

/** Group digits without converting to Number, preserving every reviewed decimal. */
export function formatExactAmount(value: string): string {
  const match = value.match(/^(-?)(\d+)(\.\d+)?(\s+[^\s]+)?$/);
  if (!match) return value;
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[3] ?? ""}${match[4] ?? ""}`;
}

export function formatReviewValue(key: string, value: string): string {
  if (
    [
      "minimumOutput",
      "expectedOutput",
      "input",
      "estimatedSpend",
      "priorityFee",
      "conversionBalance",
    ].includes(key)
  )
    return formatExactAmount(value);
  if (key === "priceReference") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime()))
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      }).format(date);
  }
  if (key === "network")
    return value === "mainnet-beta"
      ? "Solana Mainnet"
      : value === "devnet"
        ? "Solana Devnet"
        : value;
  return value;
}
