import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("@oneonly/db", async (original) => ({
  ...(await original<typeof import("@oneonly/db")>()),
  getDatabase: state.database,
}));
import { FeeError } from "@/lib/creator-fees/provider";
import { POST } from "./route";
it("preserves actionable fee allocation errors instead of reporting a connection failure", async () => {
  const message =
    "Connect your X account to this wallet so the remaining creator-fee share can be assigned to you.";
  state.database.mockRejectedValueOnce(new FeeError(message, 409));
  const response = await POST(
    new Request("https://staging.oneonly.lol/api/launchpad/launch", {
      method: "POST",
    }),
    { params: Promise.resolve({ path: ["launch"] }) },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: message });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("retry-after")).toBeNull();
});
it("does not expose unexpected internal errors", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    state.database.mockRejectedValueOnce(
      new Error("private connection details"),
    );
    const response = await POST(
      new Request("https://staging.oneonly.lol/api/launchpad/launch", {
        method: "POST",
      }),
      { params: Promise.resolve({ path: ["launch"] }) },
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private connection details",
    );
  } finally {
    log.mockRestore();
  }
});
