import { isStaging } from "./deployment";

export const tokenShareDescription =
  "One ticker. No copies. Discover, launch and trade tokens on OneOnly — pair with more than SOL and share creator fees.";

export function tokenShareTitle(ticker?: string) {
  return `Trade ${ticker ? `$${ticker}` : "this token"} on OneOnly`;
}

export function tokenShareUrl(tokenId: string, shareId?: string) {
  const origin = isStaging()
    ? "https://staging.oneonly.lol"
    : "https://oneonly.lol";
  const url = new URL(`/app/token/${encodeURIComponent(tokenId)}`, origin);
  if (shareId) url.searchParams.set("share", shareId);
  return url.toString();
}

export function creatorFeeShareUrl(shareId: string) {
  const origin = isStaging()
    ? "https://staging.oneonly.lol"
    : "https://oneonly.lol";
  const url = new URL("/app", origin);
  url.searchParams.set("share", shareId);
  return url.toString();
}

export function creatorFeePost(shareId: string) {
  return `Claimed creator fees on @oneonlylol.\n${creatorFeeShareUrl(shareId)}`;
}
