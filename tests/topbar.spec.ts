import { test, expect } from "@playwright/test";

test("dark default, remembered theme and sidebar edge control work at every size", async ({
  page,
}, info) => {
  await page.route("**/api/launchpad/**", (route) =>
    route.fulfill({
      json: { tokens: [], total: 0, profile: null, available: true },
    }),
  );
  await page.goto("/app");
  const shell = page.locator(".launchpad");
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await expect(
    page
      .locator(".lp-sidebar")
      .getByRole("button", { name: "Collapse navigation" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".lp-topbar")
      .getByRole("button", { name: "Collapse navigation" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(shell).toHaveClass(/lp-nav-collapsed/);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(shell).not.toHaveClass(/lp-nav-collapsed/);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(shell).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(shell).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page
    .getByRole("button", { name: "Search tokens", exact: false })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Search tokens" }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/oneonly-dark-search-${info.project.name}.png`,
  });
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: `/tmp/oneonly-dark-shell-${info.project.name}.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Connect X account" }).click();
  await expect(page.locator(".wallet-adapter-modal-wrapper")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Connect your wallet");
});
