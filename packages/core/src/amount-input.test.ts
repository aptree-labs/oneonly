import { expect, it } from "vitest";
import { amountReference, normalizeAmount, parseUnits } from "./launchpad";
it("normalizes decimal commas without losing atomic precision", () => {
  expect(normalizeAmount(" 0,004 ")).toBe("0.004");
  expect(parseUnits(normalizeAmount("0,000000001"), 9)).toBe(1n);
  expect(amountReference("0,004", 600)).toBe("2.40");
});
it("never displays NaN or guesses grouping separators", () => {
  for (const input of [
    "",
    "1,000.01",
    "1,2,3",
    "1e9",
    "-2",
    "Infinity",
    "abc",
  ]) {
    expect(amountReference(input, 10)).toBeNull();
    expect(() => normalizeAmount(input)).toThrow();
  }
  expect(amountReference("1", null)).toBeNull();
  expect(amountReference("1", Infinity)).toBeNull();
});
