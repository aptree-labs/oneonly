import { describe, expect, it, vi } from "vitest";
import { loadPortfolioForWallet } from "./portfolio-access";

describe("automatic portfolio access", () => {
  it("loads an existing wallet session without requesting a signature", async () => {
    const sign = vi.fn();
    const data = { wallet: "alice", balance: "1" };
    expect(
      await loadPortfolioForWallet(
        "alice",
        async () => ({ wallet: "alice" }),
        async () => data,
        sign,
      ),
    ).toBe(data);
    expect(sign).not.toHaveBeenCalled();
  });

  it.each([null, "bob"])(
    "does not load another or missing session (%s) automatically",
    async (wallet) => {
      const portfolio = vi.fn();
      expect(
        await loadPortfolioForWallet(
          "alice",
          async () => ({ wallet }),
          portfolio,
        ),
      ).toBeNull();
      expect(portfolio).not.toHaveBeenCalled();
    },
  );

  it("allows explicit sign-in before loading", async () => {
    const sign = vi.fn(async () => "alice");
    const data = { wallet: "alice" };
    expect(
      await loadPortfolioForWallet(
        "alice",
        async () => ({ wallet: null }),
        async () => data,
        sign,
      ),
    ).toBe(data);
    expect(sign).toHaveBeenCalledOnce();
  });

  it("discards a response if another tab changed the session", async () => {
    expect(
      await loadPortfolioForWallet(
        "alice",
        async () => ({ wallet: "alice" }),
        async () => ({ wallet: "bob" }),
      ),
    ).toBeNull();
  });
});
