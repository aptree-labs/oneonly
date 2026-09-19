import { expect, it } from "vitest";
import { percentageAmount } from "./trade-amount";
it("rounds percentage buttons down and preserves large balances exactly", () => {
  expect(percentageAmount("1.123456789", 100, 9, "0.01")).toBe("1.113456789");
  expect(percentageAmount("0.005", 100, 9, "0.01")).toBe("0");
  expect(percentageAmount("9007199254740993.000001", 50, 6)).toBe(
    "4503599627370496.5",
  );
  expect(percentageAmount("0.00000009", 25, 8)).toBe("0.00000002");
});
