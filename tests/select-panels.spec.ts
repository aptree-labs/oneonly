import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
test("custom asset selectors and persistent collapsible panels", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/launchpad/**", (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/launchpad/",
    )[1];
    if (path.startsWith("token/"))
      return route.fulfill({
        json: {
          id: "ux-fixture",
          name: "One Only",
          ticker: "ONLY",
          mint: "FixtureMint",
          imageId: "fixture",
          quote: "SOL",
          creator: "FixtureCreator",
          status: "active",
          description: "Interface fixture",
          trades: [],
          snapshot: {
            priceQuote: "0.000001",
            marketCapQuote: "1000",
            quoteReserve: "12",
            progress: 10,
          },
        },
      });
    if (path.startsWith("trade-assets/"))
      return route.fulfill({
        json: {
          wallet: null,
          tokenBalance: null,
          assets: [
            { symbol: "SOL", name: "Solana", decimals: 9, balance: null },
            { symbol: "USDC", name: "USD Coin", decimals: 6, balance: null },
            {
              symbol: "SPYX",
              name: "SP500 xStock",
              decimals: 8,
              balance: null,
            },
          ],
        },
      });
    if (path.startsWith("candles/"))
      return route.fulfill({
        json: { interval: "15m", candles: [], hasMore: false },
      });
    if (path.startsWith("comments/"))
      return route.fulfill({ json: { comments: [], next: null } });
    if (path.startsWith("image/"))
      return route.fulfill({
        path: resolve("apps/web/public/brand/logo-128.webp"),
        contentType: "image/webp",
      });
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() =>
    localStorage.setItem("oneonly-trading-panel", "collapsed"),
  );
  await page.goto("/app/token/ux-fixture");
  await expect(page.locator("#token-trading-panel")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Hide trading panel|Show trading panel/ }),
  ).toHaveCount(0);
  const select = page.getByRole("combobox", { name: "Pay with", exact: true });
  await expect(select).toContainText("SOL");
  await expect(select.locator("img")).toHaveAttribute(
    "src",
    "/token-icons/sol.webp",
  );
  await select.click();
  const search = page.getByRole("combobox", {
    name: "Search pay with",
    exact: true,
  });
  await expect(search).toBeFocused();
  expect(await search.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
    "none",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(search).toBeVisible();
  await search.fill("nonsense");
  await expect(page.getByText("No matching assets.")).toBeVisible();
  await search.fill("stock");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(select).toContainText("SPYX");
  await expect(select).toBeFocused();
  await select.press("ArrowDown");
  await search.fill("coin");
  await search.press("Escape");
  await expect(select).toBeFocused();
  await expect(select).toHaveAttribute("aria-expanded", "false");
  await select.click();
  await search.fill("coin");
  await search.press("Enter");
  await expect(select).toContainText("USDC");
  const slippage = page.getByRole("combobox", {
    name: "Slippage",
    exact: true,
  });
  await slippage.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(slippage).toContainText("3%");
  await page
    .getByRole("textbox", { name: "You pay", exact: true })
    .fill("1.25");
  await page
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  if (info.project.name === "desktop")
    expect((await page.locator(".lp-sidebar").boundingBox())!.width).toBe(72);
  else await expect(page.locator(".lp-sidebar")).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand navigation", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#token-trading-panel")).toBeVisible();
  await page.getByRole("combobox", { name: "Pay with", exact: true }).click();
  const menu = await page.locator(".lp-select-menu").boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(menu!.y).toBeGreaterThanOrEqual(0);
  await expect
    .poll(() =>
      page
        .locator(".lp-select-menu .lp-asset-icon")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await expect(
    page.getByRole("region", { name: "ONLY price chart" }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/oneonly-select-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "Search pay with", exact: true })
    .press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByText("— available", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Max", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".lp-chart-source")).toHaveCount(0);
  if (info.project.name === "desktop")
    await page.setViewportSize({ width: 666, height: 789 });
  const form = (await page.locator(".lp-trade-form").boundingBox())!;
  const chart = (await page.locator(".lp-chart-panel").boundingBox())!;
  const history = (await page.locator(".lp-trades").boundingBox())!;
  expect(Math.abs(form.width - chart.width)).toBeLessThan(2);
  expect(form.y + form.height).toBeLessThan(history.y);
  const receive = (await page.locator(".lp-swap-output").boundingBox())!;
  const settings = (await page.locator(".lp-swap-settings").boundingBox())!;
  expect(settings.y - receive.y - receive.height).toBeGreaterThanOrEqual(15);
  await page.locator(".lp-trade-form").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `/tmp/oneonly-trade-layout-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
