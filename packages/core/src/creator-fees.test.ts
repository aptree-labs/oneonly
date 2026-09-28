import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  validateFeeRecipients,
  completeCreatorFeeShares,
} from "./creator-fees";
import { validateLaunch } from "./launchpad";

describe("creator fee allocations", () => {
  it("leaves ordinary launches unchanged", () => {
    expect(validateFeeRecipients(undefined)).toEqual([]);
    expect(validateFeeRecipients([])).toEqual([]);
  });
  it("preserves exact integer shares and ignores display identity", () => {
    expect(
      validateFeeRecipients([
        { xId: "123", shareBps: 2500, username: "untrusted" },
        { xId: "456", shareBps: 7500 },
      ]),
    ).toEqual([
      { xId: "123", shareBps: 2500 },
      { xId: "456", shareBps: 7500 },
    ]);
  });
  it("rejects ambiguous identities, duplicate recipients and bad totals", () => {
    for (const input of [
      null,
      {},
      [{ xId: "@elon", shareBps: 10000 }],
      [{ xId: "0123", shareBps: 10000 }],
      [{ xId: "123", shareBps: 10001 }],
      [{ xId: "123", shareBps: 9999 }],
      [
        { xId: "123", shareBps: 5000 },
        { xId: "123", shareBps: 5000 },
      ],
      [{ xId: "123", shareBps: 10000.1 }],
      Array.from({ length: 9 }, (_, i) => ({
        xId: String(i + 1),
        shareBps: 1000,
      })),
    ])
      expect(() => validateFeeRecipients(input)).toThrow();
  });
  it("retains the allocation through launch validation", async () => {
    const feeRecipients = [{ xId: "123", shareBps: 10000 }];
    const value = await Effect.runPromise(
      validateLaunch({
        ticker: "TEST",
        name: "Test",
        imageId: "00000000-0000-4000-8000-000000000001",
        quote: "SOL",
        slippageBps: 100,
        feeRecipients,
      }),
    );
    expect(value.feeRecipients).toEqual(feeRecipients);
    expect(value.initialBuy).toBe("0");
  });
});

it("automatically completes the creator share without duplicate identities", () => {
  expect(completeCreatorFeeShares([], "123")).toEqual([]);
  expect(
    completeCreatorFeeShares([{ xId: "456", shareBps: 2000 }], "123"),
  ).toEqual([
    { xId: "456", shareBps: 2000 },
    { xId: "123", shareBps: 8000 },
  ]);
  expect(
    completeCreatorFeeShares(
      [
        { xId: "456", shareBps: 2000 },
        { xId: "123", shareBps: 1000 },
      ],
      "123",
    ),
  ).toEqual([
    { xId: "456", shareBps: 2000 },
    { xId: "123", shareBps: 8000 },
  ]);
  expect(
    completeCreatorFeeShares([{ xId: "456", shareBps: 10000 }], "123"),
  ).toEqual([{ xId: "456", shareBps: 10000 }]);
  expect(() =>
    completeCreatorFeeShares(
      [
        { xId: "456", shareBps: 10000 },
        { xId: "123", shareBps: 1 },
      ],
      "123",
    ),
  ).toThrow("exceed");
  expect(() =>
    completeCreatorFeeShares(
      Array.from({ length: 8 }, (_, i) => ({
        xId: String(i + 1),
        shareBps: 100,
      })),
      "123",
    ),
  ).toThrow("Leave room");
});
