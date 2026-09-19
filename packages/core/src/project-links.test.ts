import { expect, it } from "vitest";
import { Effect } from "effect";
import { projectUrl, validateLaunch } from "./launchpad";
const input = {
  ticker: "TEST",
  name: "Test",
  imageId: "00000000-0000-0000-0000-000000000001",
  quote: "SOL",
  slippageBps: 100,
};
it("allows an omitted, blank, or short story without a first buy", async () => {
  for (const description of [undefined, "", "hi"]) {
    const value = await Effect.runPromise(
      validateLaunch({ ...input, description }),
    );
    expect(value.description).toBe(description ?? "");
    expect(value.initialBuy).toBe("0");
  }
  await expect(
    Effect.runPromise(
      validateLaunch({ ...input, description: "a".repeat(501) }),
    ),
  ).rejects.toThrow();
});
it("normalizes optional project and profile links", () => {
  expect(projectUrl("example.com", "website")).toBe("https://example.com/");
  expect(projectUrl("https://www.twitter.com/project_1/?s=21", "X")).toBe(
    "https://x.com/project_1",
  );
  expect(projectUrl("t.me/+Invite123", "Telegram")).toBe(
    "https://t.me/+Invite123",
  );
  expect(projectUrl("discord.gg/abc", "Discord")).toBe(
    "https://discord.gg/abc",
  );
  expect(projectUrl("", "X")).toBe("");
});
it("rejects executable URLs, credentials, deceptive social domains and non-profile X links", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://user:pass@example.com",
    "https://x.com\\@evil.com",
  ])
    expect(() => projectUrl(url, "website")).toThrow();
  for (const url of [
    "https://x.com.evil.com/project",
    "https://x.com/project/status/123",
    "https://x.com/intent",
    "https://x.com/i",
  ])
    expect(() => projectUrl(url, "X")).toThrow();
  expect(() => projectUrl("https://evil.com/project", "Telegram")).toThrow();
  expect(() =>
    projectUrl("https://discord.com/channels/1", "Discord"),
  ).toThrow();
});
