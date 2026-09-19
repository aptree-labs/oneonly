/** Presentation only. Persistent pool/trade accounting stays in raw quote units. */
export function scaledFields<T extends object>(
  row: T,
  fields: readonly (keyof T)[],
  multiplier: number,
): T {
  if (multiplier === 1) return row;
  const adjusted = { ...row };
  for (const key of fields) {
    const value = row[key];
    if (typeof value !== "string") continue;
    const scaled = Number(value) * multiplier;
    if (!Number.isFinite(scaled))
      throw new Error("Quote amount is unavailable.");
    adjusted[key] = String(scaled) as T[keyof T];
  }
  return adjusted;
}
export const snapshotQuoteFields = [
  "priceQuote",
  "marketCapQuote",
  "quoteReserve",
  "creatorQuoteFee",
] as const;
