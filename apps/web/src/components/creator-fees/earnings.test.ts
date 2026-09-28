import { expect, it } from "vitest";
import { earnedAtomic, earnedLabel } from "./earnings";
it("shows total earned even after claiming and adds newly accrued fees", () => {
  const balance = {
    symbol: "SOL",
    decimals: 9,
    totalEntitlementAtomic: "1000000000",
    amountAtomic: "2000000",
    claimedAtomic: "998000000",
    pendingAtomic: "500000000",
  };
  expect(earnedAtomic(balance)).toBe(1500000000n);
  expect(earnedLabel([balance])).toBe("1.5 SOL");
  expect(earnedLabel([{ ...balance, totalEntitlementAtomic: undefined }])).toBe(
    "1.5 SOL",
  );
  expect(earnedLabel([{ ...balance, earnedAtomic: "2000000000" }])).toBe(
    "2 SOL",
  );
});
it("distinguishes missing earnings from zero and uses USD when priced", () => {
  expect(earnedLabel(null)).toBe("—");
  expect(earnedLabel([{ symbol: "SOL", decimals: 9, earnedAtomic: "0" }])).toBe(
    "0",
  );
  expect(earnedLabel(null, 100)).toBe("$100");
});
