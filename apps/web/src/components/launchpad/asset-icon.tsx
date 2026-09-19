const supported = new Set([
  "SOL",
  "USDC",
  "JUP",
  "MET",
  "SPYX",
  "QQQX",
  "NVDAX",
  "TSLAX",
  "CRCLX",
]);
/** Issuer/registry logos, bundled locally; never infer a logo from a user ticker. */
export function AssetIcon({ symbol }: { symbol: string }) {
  if (!supported.has(symbol)) return null;
  return (
    <img
      className="lp-asset-icon"
      src={`/token-icons/${symbol.toLowerCase()}.webp`}
      width={28}
      height={28}
      alt=""
      aria-hidden="true"
    />
  );
}
