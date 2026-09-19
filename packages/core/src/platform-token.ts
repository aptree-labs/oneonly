export const PLATFORM_TOKEN_MINT =
  "AksZnXihEv8gm3uhotkVUVe82N7wPsnGggQRbgrhMgCr";
export const PLATFORM_TOKEN_ID = "56047be4-27f3-4f72-9041-aa3a218b9198";
export const PLATFORM_TOKEN_TICKER = "ONEONLY";

export function isOfficialPlatformToken(
  mint: string,
  network: string,
): boolean {
  return network === "mainnet-beta" && mint === PLATFORM_TOKEN_MINT;
}

/** Reserve the brand, common leetspeak, affixes and single-character imitations. */
export function isReservedPlatformTicker(raw: string): boolean {
  const ticker = raw
    .trim()
    .replace(/^\$/, "")
    .replace(/\s/g, "")
    .toUpperCase()
    .replace(/^[1IL](?=[O0]N)/, "ONE")
    .replace(/0/g, "O")
    .replace(/3/g, "E")
    .replace(/[1I]/g, "L");
  const brand = PLATFORM_TOKEN_TICKER;
  if (ticker.includes(brand)) return true;
  if (Math.abs(ticker.length - brand.length) > 1) return false;
  // Levenshtein distance <= 1: a missing, extra, or substituted character.
  let a = 0,
    b = 0,
    edits = 0;
  while (a < ticker.length && b < brand.length) {
    if (ticker[a] === brand[b]) {
      a++;
      b++;
      continue;
    }
    if (++edits > 1) return false;
    if (ticker.length >= brand.length) a++;
    if (ticker.length <= brand.length) b++;
  }
  return edits + (ticker.length - a) + (brand.length - b) <= 1;
}
