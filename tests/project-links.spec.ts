import { test, expect } from "@playwright/test";
test("story and project links are optional and fit the creation form", async ({
  page,
}, info) => {
  await page.route("**/api/launchpad/config", (r) =>
    r.fulfill({
      json: {
        quotes: [{ symbol: "SOL", enabled: true }],
        prices: { SOL: 100 },
      },
    }),
  );
  await page.goto("/app/create");
  const story = page.getByRole("textbox", { name: /The story/ });
  await expect(story).not.toHaveAttribute("required");
  await story.fill("Hi");
  await expect(story).toHaveValue("Hi");
  for (const [name, value] of [
    ["Website", "https://example.com"],
    ["X account", "https://x.com/creator"],
    ["Telegram", "https://t.me/project"],
    ["Discord", "https://discord.gg/project"],
  ]) {
    const input = page.getByRole("textbox", { name, exact: true });
    await expect(input).not.toHaveAttribute("required");
    await input.fill(value);
  }
  await expect(
    page.getByRole("button", { name: "Use connected X account" }),
  ).toBeVisible();
  await expect(
    page.getByText("Verified creator account", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/oneonly-project-links-${info.project.name}.png`,
    fullPage: true,
  });
});
test("token links expose only server-verified badges and no empty story", async ({
  page,
}) => {
  await page.route("**/api/launchpad/token/links-fixture", (r) =>
    r.fulfill({
      json: {
        id: "links-fixture",
        mint: "mint",
        creator: "creator",
        pool: "pool",
        description: "",
        ticker: "ONLY",
        name: "Fixture",
        quote: "SOL",
        imageId: "fixture",
        trades: [],
        snapshot: null,
        projectLinks: {
          website: "https://example.com/",
          x: {
            url: "https://x.com/creator",
            username: "creator",
            verified: true,
          },
          telegram: "https://t.me/project",
        },
      },
    }),
  );
  await page.route("**/api/launchpad/candles/links-fixture?*", (r) =>
    r.fulfill({ json: { candles: [] } }),
  );
  await page.route("**/api/launchpad/comments/links-fixture", (r) =>
    r.fulfill({ json: { comments: [], next: null } }),
  );
  await page.goto("/app/token/links-fixture");
  await expect(
    page.getByRole("heading", { name: "About the token", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /@creator/ })).toHaveAttribute(
    "href",
    "https://x.com/creator",
  );
  await expect(
    page.getByRole("img", { name: "Verified creator X account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Website", exact: true }),
  ).toHaveAttribute("rel", "noopener noreferrer");
});
