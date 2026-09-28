import { afterEach, expect, it, vi } from "vitest";
import {
  creatorFeePost,
  tokenShareTitle,
  tokenShareUrl,
  tokenShareDescription,
} from "./token-sharing";
afterEach(() => vi.unstubAllEnvs());
it("promotes the token with a trading link and a discreet per-claim proof", () => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  expect(creatorFeePost("token-1", "claim-1", "ANDY")).toBe(
    "Trade $ANDY on OneOnly.\nOne ticker. No copies. Launch, trade, and share creator fees.\nhttps://oneonly.lol/app/token/token-1?share=claim-1",
  );
  expect(tokenShareTitle("ANDY")).toBe("Trade $ANDY on OneOnly");
  expect(tokenShareDescription).toContain("One ticker. No copies.");
  expect(tokenShareUrl("token-1")).not.toContain("share=");
});
it("keeps staging token links on staging, where those tokens are listed", () => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  expect(tokenShareUrl("token-1", "claim-2")).toBe(
    "https://staging.oneonly.lol/app/token/token-1?share=claim-2",
  );
});
