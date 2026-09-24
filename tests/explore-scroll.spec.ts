import { expect, test } from "@playwright/test";

test("Explore appends bounded batches, retries failures, deduplicates, and resets filters", async ({
  page,
}) => {
  const calls: { page: number; pair: string; sort: string }[] = [];
  let failSecond = true;
  await page.route("**/api/launchpad/tokens?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get("page"));
    const pair = params.get("pair") ?? "All";
    const sort = params.get("sort") ?? "volume";
    calls.push({ page: offset, pair, sort });
    if (offset === 1 && failSecond)
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    const count = pair === "SOL" ? 3 : offset === 2 ? 1 : 24;
    await route.fulfill({
      json: {
        total: pair === "SOL" ? 3 : 49,
        asOf: new Date().toISOString(),
        tokens: Array.from({ length: count }, (_, i) => {
          const n = offset === 1 && i === 0 ? 23 : offset * 24 + i;
          return {
            id: `token-${pair}-${sort}-${n}`,
            ticker: `TOKEN${n}`,
            name: `Token ${n}`,
            description: "",
            imageId: "fixture",
            quote: "SOL",
            mint: `Mint${n}`,
            pool: "pool",
            status: "active",
            snapshot: null,
            marketCapUsd: 100,
            volumeUsd24h: 10,
          };
        }),
      },
    });
  });
  await page.route("**/api/launchpad/image/fixture", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto("/app");
  await expect(page.locator(".lp-token-card")).toHaveCount(24);
  expect(calls.every((call) => call.page === 0)).toBe(true);
  await page.getByTestId("token-scroll-sentinel").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn’t load more tokens" }),
  ).toBeVisible();
  await expect(page.locator(".lp-token-card")).toHaveCount(24);
  failSecond = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".lp-token-card")).toHaveCount(47);
  await page.getByTestId("token-scroll-sentinel").scrollIntoViewIfNeeded();
  await expect(page.locator(".lp-token-card")).toHaveCount(48);
  await expect(page.getByText("You’re all caught up.")).toBeVisible();
  expect(calls.every((call) => call.page <= 2)).toBe(true);
  const pairControls = page.getByRole("group", {
    name: "Paired with",
    exact: true,
  });
  await pairControls.getByRole("button", { name: "SOL", exact: true }).click();
  await expect(page.locator(".lp-token-card")).toHaveCount(3);
  await pairControls.getByRole("button", { name: "SOL", exact: true }).click();
  await expect(page.locator(".lp-count")).toHaveText("3");
  expect(
    calls
      .filter((call) => call.pair === "SOL")
      .every((call) => call.page === 0),
  ).toBe(true);
  await page.getByRole("button", { name: "Newest", exact: true }).click();
  await expect(page.locator(".lp-token-card-link").first()).toHaveAttribute(
    "href",
    "/app/token/token-SOL-newest-0",
  );
  await expect(page.locator(".lp-token-card")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
