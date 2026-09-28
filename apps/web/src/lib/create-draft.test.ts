import { expect, it } from "vitest";
import {
  readCreateDraft,
  serializeCreateDraft,
  type CreateDraft,
} from "./create-draft";
const draft: CreateDraft = {
  ticker: "TEST",
  name: "Test token",
  description: "A story",
  website: "",
  xUrl: "",
  xSource: "link",
  telegram: "",
  discord: "",
  quote: "JUP",
  payment: "SOL",
  initialBuy: "0.2",
  slippage: "1",
  image: "data:image/png;base64,aGVsbG8=",
  includeFirstBuy: false,
  feeRecipients: [{ xId: "123", username: "recipient", shareBps: 2000 }],
};
it("restores the complete launch draft only for its wallet before expiry", () => {
  const raw = serializeCreateDraft(draft, "wallet-a", 1000);
  expect(readCreateDraft(raw, "wallet-a", 1100)).toEqual(draft);
  expect(readCreateDraft(raw, "wallet-b", 1100)).toBeNull();
  expect(readCreateDraft(raw, "wallet-a", 1000 + 30 * 60_000)).toBeNull();
});
it("ignores corrupt or oversized draft data", () => {
  for (const raw of [
    null,
    "{",
    "x".repeat(500001),
    JSON.stringify({
      owner: "wallet-a",
      expires: 2000,
      draft: { ...draft, feeRecipients: [null] },
    }),
    JSON.stringify({
      owner: "wallet-a",
      expires: 2000,
      draft: { ...draft, name: {} },
    }),
  ]) {
    expect(readCreateDraft(raw, "wallet-a", 1100)).toBeNull();
  }
});
