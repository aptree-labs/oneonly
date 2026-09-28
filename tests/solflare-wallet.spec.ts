import { test, expect } from "@playwright/test";

test("Solflare is available without an injected Wallet Standard extension", async ({
  page,
}) => {
  await page.route("**/api/launchpad/**", (route) =>
    route.fulfill({
      json: { tokens: [], total: 0, profile: null, available: true },
    }),
  );
  await page.goto("/app");
  await page.locator(".wallet-adapter-button-trigger").click();
  const modal = page.locator(".wallet-adapter-modal-wrapper");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: /Solflare/ })).toHaveCount(1);
  await expect(modal.getByRole("button", { name: /Solflare/ })).toBeVisible();
});
