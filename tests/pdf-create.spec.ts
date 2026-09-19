import { test, expect } from "@playwright/test";
test("ticker input capitalizes and links to the existing launch", async ({
  page,
}) => {
  await page.route("**/api/launchpad/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/config"))
      return route.fulfill({
        json: {
          quotes: [
            {
              symbol: "SOL",
              name: "Solana",
              enabled: true,
              creationEnabled: true,
              displayUsdPrice: 100,
              multiplier: 1,
            },
          ],
          prices: { SOL: 100 },
        },
      });
    if (path.endsWith("/ticker"))
      return route.fulfill({
        json: { ticker: "STABLE", available: false, tokenId: "existing" },
      });
    return route.fulfill({ json: {} });
  });
  await page.goto("/app/create");
  await page
    .getByRole("textbox", { name: "Token name", exact: true })
    .fill("1");
  const ticker = page.getByRole("textbox", { name: /Ticker/ });
  await ticker.fill("stable");
  await expect(ticker).toHaveValue("STABLE");
  await expect(
    page.getByRole("link", { name: "View token", exact: true }),
  ).toHaveAttribute("href", "/app/token/existing");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
