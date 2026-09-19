import { expect, it } from "vitest";
import { ApiError, tradeSubmissionFailure } from "./trade-submission";

it("unlocks a trade rejected before broadcast instead of leaving it pending", () => {
  for (const status of [400, 401, 403, 409, 413, 415, 422, 429]) {
    expect(tradeSubmissionFailure(true, new ApiError("Rejected", status))).toBe(
      "approval-failed",
    );
  }
});

it("keeps recovery after ambiguous submission failures to avoid duplicate spending", () => {
  for (const error of [
    new Error("Network timeout"),
    new ApiError("Unavailable", 503),
  ]) {
    expect(tradeSubmissionFailure(true, error)).toBe("submitted");
    expect(tradeSubmissionFailure(false, error)).toBe("approval-failed");
  }
});
