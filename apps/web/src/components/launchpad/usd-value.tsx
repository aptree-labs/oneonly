"use client";
import NumberFlow from "@number-flow/react";
export function UsdValue({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <>—</>;
  const format = {
    style: "currency",
    currency: "USD",
    ...(value > 0 && value < 0.01
      ? { maximumSignificantDigits: 4 }
      : { maximumFractionDigits: 2 }),
  } satisfies Intl.NumberFormatOptions;
  return (
    <NumberFlow
      value={value}
      locales="en-US"
      format={format}
      aria-label={new Intl.NumberFormat("en-US", format).format(value)}
    />
  );
}
