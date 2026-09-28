import { test, expect } from "@playwright/test";

for (const outcome of ["confirmed", "failed", "expired", "claim"] as const) {
  test(`launch navigation: ${outcome}`, async ({ page }) => {
    const id = "redirect-test";
    const tokenId = "00000000-0000-4000-8000-000000000001";
    let status = "submitted";
    let deliveredStatus = "";
    await page.addInitScript((id) => {
      sessionStorage.setItem("oneonly-intent-mainnet-beta", id);
      sessionStorage.setItem("oneonly-intent-devnet", id);
    }, id);
    await page.route("**/api/creator-fees/**", (route) =>
      route.fulfill({ json: { enabled: false } }),
    );
    await page.route("**/api/launchpad/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/config"))
        return route.fulfill({ json: { quotes: [], network: "mainnet-beta" } });
      if (path.includes("/token/"))
        return route.fulfill({ status: 404, json: { error: "Test token" } });
      if (path.endsWith(`/intent/${id}`)) {
        deliveredStatus = status;
        return route.fulfill({
          json: {
            id,
            tokenId,
            kind: outcome === "claim" ? "claim" : "launch",
            status,
            details: { ticker: "TEST", network: "mainnet-beta" },
          },
        });
      }
      return route.fulfill({ json: { tokens: [], total: 0, assets: [] } });
    });
    await page.goto("/app/create");
    await expect.poll(() => deliveredStatus).toBe("submitted");
    await expect(page).toHaveURL(/\/app\/create$/);
    status = outcome === "claim" ? "confirmed" : outcome;
    await expect.poll(() => deliveredStatus, { timeout: 15_000 }).toBe(status);
    if (outcome === "confirmed") {
      await expect(page).toHaveURL(new RegExp(`/app/token/${tokenId}$`), {
        timeout: 20_000,
      });
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("oneonly-intent-mainnet-beta"),
        ),
      ).toBeNull();
    } else {
      if (outcome === "claim")
        await expect(
          page.getByText("Fees claimed", { exact: true }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("heading", {
            name:
              outcome === "expired"
                ? "This quote expired."
                : "Check it. Then send it.",
          }),
        ).toBeVisible();
      await expect(page).toHaveURL(/\/app\/create$/);
    }
  });
}
