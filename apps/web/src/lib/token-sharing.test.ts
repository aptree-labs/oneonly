import { afterEach, expect, it, vi } from "vitest";
import {
  creatorFeePost,
  creatorFeeShareUrl,
  tokenShareTitle,
  tokenShareUrl,
  tokenShareDescription,
} from "./token-sharing";
afterEach(() => vi.unstubAllEnvs());
it("shares a concise creator-fee post linking Explore with a per-claim proof", () => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "production");
  expect(creatorFeePost("claim-1")).toBe(
    "Claimed creator fees on @oneonlylol.\nhttps://oneonly.lol/app?share=claim-1",
  );
  expect(tokenShareTitle("ANDY")).toBe("Trade $ANDY on OneOnly");
  expect(tokenShareDescription).toContain("One ticker. No copies.");
  expect(tokenShareUrl("token-1")).not.toContain("share=");
});
it("keeps staging token links on staging, where those tokens are listed", () => {
  vi.stubEnv("ONEONLY_ENVIRONMENT", "staging");
  expect(creatorFeeShareUrl("claim-2")).toBe(
    "https://staging.oneonly.lol/app?share=claim-2",
  );
  expect(tokenShareUrl("token-1", "claim-2")).toBe(
    "https://staging.oneonly.lol/app/token/token-1?share=claim-2",
  );
});
