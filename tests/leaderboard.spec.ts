import { expect, test } from "@playwright/test";

test("trader rankings paginate, switch periods, copy wallets, and recover from errors", async ({
  page,
  context,
}) => {
  const base = new URL(test.info().project.use.baseURL as string).origin;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: base,
  });
  let fail = false;
  await page.route("**/api/launchpad/leaderboard?*", async (route) => {
    if (fail)
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    const period = new URL(route.request().url()).searchParams.get("period");
    await route.fulfill({
      json: {
        period,
        asOf: "2026-09-24T12:00:00Z",
        totalTraders: period === "all" ? 0 : 32,
        traders:
          period === "all"
            ? []
            : Array.from({ length: 32 }, (_, i) => ({
                wallet: `Wallet${String(i).padStart(2, "0")}111111111111111111111111111111`,
                rank: i + 1,
                volumeUsd: (32 - i) * (period === "7d" ? 1000 : 100),
                trades: 10,
                buys: 6,
                sells: 4,
                tokens: 3,
                profile:
                  i === 0 ? { username: "oneonlylol", avatar: null } : null,
              })),
      },
    });
  });
  await page.goto("/app/leaderboard");
  await expect(page.getByRole("link", { name: "@oneonlylol" })).toHaveAttribute(
    "href",
    "https://x.com/oneonlylol",
  );
  await expect(page.locator(".lp-leaderboard-table tbody tr")).toHaveCount(25);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Copy wallet Wallet00", exact: false })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Wallet address copied" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".lp-leaderboard-table tbody tr")).toHaveCount(7);
  await page.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "7 days", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".lp-leaderboard-pagination")).toContainText(
    "1 / 2",
  );
  await expect(
    page.locator(".lp-leaderboard-table tbody tr").first().locator("td").nth(1),
  ).toHaveAttribute("title", "$32,000.00");
  await page.screenshot({
    path: test.info().outputPath("leaderboard.png"),
    fullPage: true,
  });
  fail = true;
  await page.getByRole("button", { name: "Refresh leaderboard" }).click();
  await expect(
    page.locator(".lp-leaderboard").getByRole("alert"),
  ).toContainText("couldn’t refresh");
  await expect(page.locator(".lp-leaderboard-table tbody tr")).toHaveCount(25);
  fail = false;
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await expect(
    page.getByText("No priced trades in this period yet."),
  ).toBeVisible();
});
