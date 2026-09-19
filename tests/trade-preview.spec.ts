import { test, expect } from "@playwright/test";
test("live receive previews debounce, animate, and discard stale quotes", async ({
  page,
}, info) => {
  const amounts: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/launchpad/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.split("/api/launchpad/")[1];
    if (path.startsWith("token/"))
      return route.fulfill({
        json: {
          id: "preview-fixture",
          name: "Preview",
          ticker: "TEST",
          mint: "FixtureMint",
          imageId: "fixture",
          quote: "SOL",
          priceUsd: 0.01,
          reserveUsd: 1000,
          marketCapUsd: 10000,
          creator: "Creator",
          status: "active",
          description: "Preview fixture",
          trades: [],
          snapshot: {
            priceQuote: "0.000001",
            marketCapQuote: "1000",
            quoteReserve: "10",
            progress: 5,
          },
        },
      });
    if (path.startsWith("trade-assets/"))
      return route.fulfill({
        json: {
          wallet: null,
          tokenBalance: null,
          assets: [
            {
              symbol: "SOL",
              name: "Solana",
              decimals: 9,
              balance: null,
              usd: 100,
            },
            {
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
              balance: null,
              usd: 1,
            },
          ],
        },
      });
    if (path.startsWith("candles/"))
      return route.fulfill({ json: { candles: [], hasMore: false } });
    if (path.startsWith("comments/"))
      return route.fulfill({ json: { comments: [] } });
    if (path.startsWith("trade-preview/")) {
      const amount = url.searchParams.get("amount")!;
      amounts.push(amount);
      if (amount === "3")
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      if (amount === "1")
        await new Promise((resolve) => setTimeout(resolve, 1200));
      return route
        .fulfill({
          json: {
            output: String(Number(amount) * 1000),
            minimumOutput: String(Number(amount) * 990),
            outputSymbol:
              url.searchParams.get("side") === "buy"
                ? "TEST"
                : url.searchParams.get("settlement"),
            quotedAt: new Date().toISOString(),
          },
        })
        .catch(() => {});
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/app/token/preview-fixture");
  const input = page.getByRole("textbox", { name: "You pay", exact: true });
  const output = page.getByLabel("Estimated receive amount");
  await input.pressSequentially("12", { delay: 40 });
  await expect(output).toHaveAttribute("title", "12,000");
  expect(amounts).toEqual(["12"]);
  await expect(
    page.getByLabel("Payment value in USD").locator("number-flow-react"),
  ).toHaveAttribute("aria-label", "$1,200.00");
  await expect(
    page
      .getByLabel("Estimated receive value in USD")
      .locator("number-flow-react"),
  ).toHaveAttribute("aria-label", "$120.00");
  await expect(output.locator("number-flow-react")).toHaveCount(1);
  await input.fill("1");
  await expect(page.getByText("Getting quote…")).toBeVisible();
  await expect(output).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => amounts.includes("1")).toBe(true);
  await input.fill("2");
  await expect(output).toHaveAttribute("title", "2,000");
  await page.waitForTimeout(1300);
  await expect(output).toHaveAttribute("title", "2,000");
  await input.fill("2,");
  await expect(output).toHaveAttribute("title", "2,000");
  await input.fill("3");
  await expect(page.getByText("Quote unavailable")).toBeVisible();
  await expect(output).not.toHaveAttribute("title");
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await input.fill("");
  await expect(output).not.toHaveAttribute("title");
  await expect(output.locator("number-flow-react")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Pay with", exact: true }).click();
  await page.getByRole("option", { name: /USDC/ }).click();
  await input.fill("89");
  await expect(output).toHaveAttribute("title", "89,000");
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await expect(output).not.toHaveAttribute("title");
  await page
    .getByRole("textbox", { name: "You sell", exact: true })
    .fill("0,004");
  await expect(output).toHaveAttribute("title", "4");
  await page.screenshot({
    path: `/tmp/oneonly-live-preview-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
