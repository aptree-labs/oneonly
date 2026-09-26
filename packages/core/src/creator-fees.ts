import { LaunchError } from "./launchpad";

export type FeeRecipient = { xId: string; shareBps: number };
export const MAX_FEE_RECIPIENTS = 8;

/** Fixed creator-fee shares; user handles are never financial identities. */
export function validateFeeRecipients(input: unknown): FeeRecipient[] {
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
  if (recipients.reduce((sum, row) => sum + row.shareBps, 0) !== 10000)
    return invalid("Creator fee shares must total 100%.");
  return recipients;
}
