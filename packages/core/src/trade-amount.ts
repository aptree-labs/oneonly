import { formatUnits } from "./launchpad";

/** Percentage buttons use exact displayed units and always round down. */
export function percentageAmount(
  balance: string,
  percent: number,
  decimals: number,
  reserve = "0",
): string {
  if (
    ![25, 50, 75, 100].includes(percent) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 9
  )
    throw new Error("Invalid percentage amount");
  const units = (value: string) => {
    if (!/^\d+(\.\d+)?$/.test(value) || value.length > 40)
      throw new Error("Invalid balance");
    const [whole, fraction = ""] = value.split(".");
    return (
      BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0")
    );
  };
  const available = units(balance) - units(reserve);
  return formatUnits(
    available > 0n ? (available * BigInt(percent)) / 100n : 0n,
    decimals,
  );
}
