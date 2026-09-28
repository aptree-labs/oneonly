import { LaunchError } from "./launchpad";

export type FeeRecipient = { xId: string; shareBps: number };
export const MAX_FEE_RECIPIENTS = 8;

/** Fixed creator-fee shares; user handles are never financial identities. */
export function validateFeeRecipients(
  input: unknown,
  requireFullAllocation = true,
): FeeRecipient[] {
  if (input === undefined) return [];
  const invalid = (message: string): never => {
    throw new LaunchError({ message, status: 400 });
  };
  if (!Array.isArray(input)) return invalid("Choose valid fee recipients.");
  if (!input.length) return [];
  if (input.length > MAX_FEE_RECIPIENTS)
    return invalid(`Choose up to ${MAX_FEE_RECIPIENTS} fee recipients.`);
  const ids = new Set<string>();
  const recipients = input.map((value): FeeRecipient => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return invalid("Choose valid fee recipients.");
    const { xId, shareBps } = value as Record<string, unknown>;
    if (typeof xId !== "string" || !/^[1-9][0-9]{0,24}$/.test(xId))
      return invalid("Select an X account from the search results.");
    if (ids.has(xId)) return invalid("Each X account can appear only once.");
    ids.add(xId);
    if (
      typeof shareBps !== "number" ||
      !Number.isInteger(shareBps) ||
      shareBps < 1 ||
      shareBps > 10000
    )
      return invalid("Each fee share must be between 0.01% and 100%.");
    return { xId, shareBps };
  });
  const total = recipients.reduce((sum, row) => sum + row.shareBps, 0);
  if (total > 10000) return invalid("Creator fee shares cannot exceed 100%.");
  if (requireFullAllocation && total !== 10000)
    return invalid("Creator fee shares must total 100%.");
  return recipients;
}

/** Only pass the creator identity resolved from their authenticated wallet. */
export function completeCreatorFeeShares(
  input: unknown,
  creatorXId: string,
): FeeRecipient[] {
  const recipients = validateFeeRecipients(input, false);
  // No sharing keeps ordinary wallet-based creator collection unchanged.
  if (!recipients.length) return [];
  const remaining =
    10000 - recipients.reduce((sum, row) => sum + row.shareBps, 0);
  if (!remaining) return recipients;
  const existing = recipients.find((row) => row.xId === creatorXId);
  if (!existing && recipients.length === MAX_FEE_RECIPIENTS)
    throw new LaunchError({
      message:
        "Leave room for your automatic share: choose up to 7 other recipients, or allocate the full 100%.",
      status: 400,
    });
  return validateFeeRecipients(
    existing
      ? recipients.map((row) =>
          row.xId === creatorXId
            ? { ...row, shareBps: row.shareBps + remaining }
            : row,
        )
      : [...recipients, { xId: creatorXId, shareBps: remaining }],
  );
}
