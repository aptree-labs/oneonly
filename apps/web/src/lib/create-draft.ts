import type { FeeRecipient } from "@/components/creator-fees/client";
const fields = [
  "ticker",
  "name",
  "description",
  "website",
  "xUrl",
  "telegram",
  "discord",
  "quote",
  "payment",
  "initialBuy",
  "slippage",
  "image",
] as const;
export type CreateDraft = Record<(typeof fields)[number], string> & {
  xSource: "link" | "connected";
  includeFirstBuy: boolean;
  feeRecipients: FeeRecipient[];
};
export function readCreateDraft(
  raw: string | null,
  wallet: string,
  now = Date.now(),
): CreateDraft | null {
  try {
    if (!raw || raw.length > 500_000) return null;
    const { owner, expires, draft } = JSON.parse(raw);
    if (
      owner !== wallet ||
      !Number.isFinite(expires) ||
      expires <= now ||
      expires > now + 30 * 60_000 ||
      !draft ||
      fields.some((field) => typeof draft[field] !== "string") ||
      !["link", "connected"].includes(draft.xSource) ||
      typeof draft.includeFirstBuy !== "boolean" ||
      !Array.isArray(draft.feeRecipients) ||
      draft.feeRecipients.length > 8 ||
      draft.feeRecipients.some(
        (row: FeeRecipient) =>
          !row ||
          typeof row.xId !== "string" ||
          typeof row.username !== "string" ||
          !Number.isInteger(row.shareBps) ||
          row.shareBps < 0 ||
          row.shareBps > 10000 ||
          (row.name !== undefined && typeof row.name !== "string") ||
          (row.avatar != null && typeof row.avatar !== "string"),
      )
    )
      return null;
    return draft;
  } catch {
    return null;
  }
}
export function serializeCreateDraft(
  draft: CreateDraft,
  wallet: string,
  now = Date.now(),
) {
  return JSON.stringify({ owner: wallet, expires: now + 30 * 60_000, draft });
}
