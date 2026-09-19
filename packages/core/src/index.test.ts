import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { isSolanaAddress, validateWallet } from "./index";
const valid = "So11111111111111111111111111111111111111112";
describe("Solana signup validation", () => {
  it("accepts 32-byte public keys, including leading zero bytes", () => {
    expect(isSolanaAddress(valid)).toBe(true);
    expect(isSolanaAddress("11111111111111111111111111111111")).toBe(true);
  });
  it("rejects wrong decoded lengths and forbidden base58 characters", () => {
    for (const address of [
      "",
      "1".repeat(31),
      "1".repeat(33),
      "z".repeat(44),
      "O".repeat(32),
      "0".repeat(32),
    ])
      expect(isSolanaAddress(address)).toBe(false);
  });
  it("trims whitespace while retaining the case-sensitive address", async () => {
    expect(
      await Effect.runPromise(validateWallet({ wallet: ` ${valid} ` })),
    ).toBe(valid);
  });
  it("rejects malformed requests through the typed error channel", async () => {
    for (const input of [null, {}, { wallet: 123 }, { wallet: "bad" }]) {
      const result = await Effect.runPromise(
        Effect.either(validateWallet(input)),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left")
        expect(result.left._tag).toBe("InvalidSignup");
    }
  });
});
