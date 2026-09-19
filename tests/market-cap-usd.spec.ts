import { test, expect } from "@playwright/test";

test("USD market cap accompanies every pair and missing prices stay unknown", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.route("**/api/launchpad/config", (r) =>
    r.fulfill({ json: { quotes: [], prices: {} } }),
  );
  await page.route("**/api/launchpad/candles/usd-*?*", (r) =>
    r.fulfill({ json: { candles: [] } }),
  );
  await page.route("**/api/launchpad/comments/usd-*", (r) =>
    r.fulfill({ json: { comments: [], next: null } }),
  );
  await page.route("**/api/launchpad/token/usd-*", (r) => {
    const quote = r.request().url().split("usd-")[1];
    return r.fulfill({
      json: {
        id: `usd-${quote}`,
        ticker: "ONLY",
        name: "Fixture",
        description: "",
        mint: "mint",
        creator: "creator",
        pool: "pool",
        imageId: "fixture",
        quote,
        marketCapUsd: quote === "UNKNOWN" ? null : 12500,
        trades: [],
        stale: false,
        snapshot: {
          marketCapQuote: "125",
          priceQuote: ".000000125",
          quoteReserve: "10",
          progress: 10,
          graduated: false,
          creatorQuoteFee: "0",
        },
      },
    });
  });
  for (const quote of [
    "SOL",
    "USDC",
    "SPYX",
    "QQQX",
    "NVDAX",
    "TSLAX",
    "CRCLX",
    "JUP",
    "MET",
    "UNKNOWN",
  ]) {
    await page.goto(`/app/token/usd-${quote}`);
    const metric = page.locator(".lp-metrics > div").first();
    await expect(metric).toContainText("Market cap · USD");
    await expect(metric.locator("strong")).toHaveText(
      quote === "UNKNOWN" ? "—" : "$12.5K",
    );
    await expect(metric.locator(".lp-market-cap-quote")).toHaveText(
      `125 ${quote}`,
    );
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
