import { describe, expect, it } from "vitest";
import { formatNumber, formatExactAmount, formatReviewValue } from "./display";

describe("human-readable display amounts", () => {
  it("abbreviates large values and groups ordinary values", () => {
    expect(formatNumber(8876.89)).toBe("8.88K");
    expect(formatNumber(683_290_000)).toBe("683.29M");
    expect(formatNumber(-1837033.940446)).toBe("-1.84M");
    expect(formatNumber(25.126)).toBe("25.13");
  });
  it("keeps tiny nonzero values readable without scientific notation or false zero", () => {
    expect(formatNumber("0.000000025")).toBe("0.000000025");
    expect(formatNumber("0.000000000000123456")).toBe("0.0000000000001235");
    expect(formatNumber(0)).toBe("0");
    for (const value of [null, undefined, "", "NaN", Infinity])
      expect(formatNumber(value)).toBe("—");
  });
  it("preserves exact reviewed amounts, including beyond JS safe integer precision", () => {
    expect(formatExactAmount("1837033.940446 GIDDY")).toBe(
      "1,837,033.940446 GIDDY",
    );
    expect(formatExactAmount("9007199254740993.000001 SOL")).toBe(
      "9,007,199,254,740,993.000001 SOL",
    );
    expect(formatReviewValue("pool", "123456789")).toBe("123456789");
    expect(formatReviewValue("input", "0.05 SOL")).toBe("0.05 SOL");
    expect(
      formatReviewValue("priceReference", "2026-09-15T06:55:52.733Z"),
    ).toContain("6:55:52 AM UTC");
  });
});
