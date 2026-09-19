import { test, expect } from "@playwright/test";
const totals = {
  asOf: "2026-09-16T12:00:00Z",
  network: "mainnet-beta",
  launches: 12,
  graduations: 2,
  uncheckedPools: 0,
  coveredPools: 10,
  volumeUsd: 123456.78,
  trades: 425,
  unpricedTrades: 5,
  volumeComplete: false,
  volumes: [
    {
      symbol: "SOL",
      mint: "sol",
      amount: "1234.5678",
      usd: "123456.78",
      trades: 425,
      unpriced: 5,
    },
  ],
};
test("office shows real-data states and navigation fits on mobile", async ({
  page,
}, info) => {
  await page.route("**/api/launchpad/office", (r) =>
    r.fulfill({ json: totals }),
  );
  await page.route("**/api/launchpad/office-fees", (r) =>
    r.fulfill({
      json: {
        asOf: totals.asOf,
        pools: 12,
        checked: 11,
        graduated: 2,
        usd: { revenue: 425.6, creatorPayouts: 110, complete: true },
        assets: [
          {
            symbol: "SOL",
            mint: "sol",
            revenue: "4.256",
            creatorPayouts: "1.1",
          },
        ],
      },
    }),
  );
  await page.goto("/app/office");
  await expect(
    page.getByRole("heading", { name: "Retard Office." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Retard Office" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByText("425 indexed trades · Partial history"),
  ).toBeVisible();
  await expect(
    page.getByText("Curve fees · Current USD value · Partial"),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Volume" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/oneonly-office-${info.project.name}.png`,
    fullPage: true,
  });
});
test("fee read failure is unavailable, never zero", async ({ page }) => {
  await page.route("**/api/launchpad/office", (r) =>
    r.fulfill({ json: totals }),
  );
  await page.route("**/api/launchpad/office-fees", (r) =>
    r.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.goto("/app/office");
  await expect(page.locator(".lp-office [role=alert]")).toHaveText(
    "Fee totals are temporarily unavailable.",
  );
  await expect(
    page.locator(".lp-office-value").filter({ hasText: "Unavailable" }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Refresh office totals" }),
  ).toBeEnabled();
});
