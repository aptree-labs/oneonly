import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("search overlay filters, paginates, handles failures, and navigates by keyboard", async ({
  page,
}, testInfo) => {
  const requests: URL[] = [];
  await page.route("**/api/launchpad/tokens?*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const term = url.searchParams.get("search");
    if (term === "error") return route.fulfill({ status: 503, json: {} });
    if (term === "slow")
      await new Promise((resolve) => setTimeout(resolve, 1000));
    const pageNumber = Number(url.searchParams.get("page") ?? 0);
    await route.fulfill({
      json: {
        total: term === "missing" ? 0 : 30,
        tokens:
          term === "missing"
            ? []
            : Array.from({ length: pageNumber ? 6 : 24 }, (_, i) => ({
                id: `fixture-${pageNumber * 24 + i}`,
                ticker: `ONLY${pageNumber * 24 + i}`,
                name: `${term === "fresh" ? "Fresh" : "Token"} ${pageNumber * 24 + i}`,
                quote: "SOL",
                imageId: "fixture",
                marketCapUsd: i === 0 ? null : 12345,
                activatedAt: "2026-09-15T12:00:00Z",
                snapshot: null,
              })),
      },
    });
  });
  await page.route("**/api/launchpad/image/fixture", (route) =>
    route.fulfill({
      path: resolve("apps/web/public/brand/logo-128.webp"),
      contentType: "image/webp",
    }),
  );
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: /Search tokens/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Search tokens" });
  const input = dialog.getByRole("combobox", {
    name: "Search name, ticker, or contract address",
  });
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("option")).toHaveCount(24);
  await dialog.getByRole("button", { name: "Next search page" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(6);
  await expect(dialog).toContainText("25–30 of 30");
  await input.fill("slow");
  await expect(dialog.getByRole("listbox")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await page.waitForRequest((req) => req.url().includes("search=slow"));
  await input.fill("fresh");
  await expect(dialog.getByRole("option").first()).toContainText("Fresh 0");
  await expect(dialog).toContainText("1–24 of 30");
  await input.fill("missing");
  await expect(
    dialog.getByText("No matching tokens", { exact: true }),
  ).toBeVisible();
  await input.fill("error");
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("listbox")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await dialog.getByRole("button", { name: "Clear search" }).click();
  await dialog.getByRole("button", { name: "24h", exact: true }).click();
  await dialog.getByRole("button", { name: "Market cap", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Filter by stock pair" }).click();
  await dialog.getByRole("option", { name: /^SPYX/ }).click();
  await expect(dialog.getByRole("option")).toHaveCount(24);
  expect(
    requests.some(
      (url) =>
        url.searchParams.get("pair") === "SPYX" &&
        url.searchParams.get("age") === "24h" &&
        url.searchParams.get("sort") === "market-cap" &&
        url.searchParams.get("page") === "0",
    ),
  ).toBe(true);
  for (const symbol of ["JUP", "MET"]) {
    const request = page.waitForRequest((request) =>
      request.url().includes(`pair=${symbol}`),
    );
    await dialog.getByRole("button", { name: symbol, exact: true }).click();
    await request;
    await expect(
      dialog.getByRole("button", { name: symbol, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await dialog
        .locator(`img[src="/token-icons/${symbol.toLowerCase()}.webp"]`)
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("token-search.png") });
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("option")).toHaveCount(24);
  await input.press("ArrowDown");
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Intercept the destination so this test only exercises search navigation.
  await page.route("**/app/token/fixture-1", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Selected token</h1>",
    }),
  );
  await input.press("Enter");
  await expect(page).toHaveURL(/\/app\/token\/fixture-1/);
});
