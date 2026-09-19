import { describe, expect, it } from "vitest";
import { formatScaledUnits, parseScaledUnits } from "./scaled-amounts";

describe("scaled token amounts", () => {
  it("keeps regular SOL and USDC amounts unchanged", () => {
    expect(parseScaledUnits("1.123456789", 9)).toBe(1123456789n);
    expect(formatScaledUnits(1234567n, 6)).toBe("1.234567");
  });
  it("converts displayed stock input to raw atoms without exceeding the requested spend", () => {
    expect(parseScaledUnits("15", 8, 1.25)).toBe(1200000000n);
    expect(formatScaledUnits(1200000000n, 8, 1.25)).toBe("15");
    expect(parseScaledUnits("1", 8, 1.5)).toBe(66666666n);
    expect(formatScaledUnits(66666666n, 8, 1.5)).toBe("0.99999999");
  });
  it("preserves precision above the JavaScript safe integer range", () => {
    expect(formatScaledUnits(18000000000000000000n, 8, 1.25)).toBe(
      "225000000000",
    );
    expect(parseScaledUnits("225000000000", 8, 1.25)).toBe(
      18000000000000000000n,
    );
  });
  it("rejects invalid scales, zero-atom input and raw overflow", () => {
    for (const scale of [0, -1, NaN, Infinity])
      expect(() => parseScaledUnits("1", 8, scale)).toThrow();
    expect(() => parseScaledUnits("0.00000001", 8, 2)).toThrow();
    expect(() => parseScaledUnits("184467440737", 8, 0.5)).toThrow();
  });
});
