import { test, expect } from "@playwright/test";
const profile = {
  xId: "123",
  username: "elonmusk",
  name: "Elon Musk",
  avatar: null,
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/launchpad/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/config"))
      return route.fulfill({
        json: {
          quotes: [
            { symbol: "SOL", enabled: true, creationEnabled: true },
            { symbol: "JUP", enabled: true, creationEnabled: true },
          ],
          prices: { SOL: 100, JUP: 1 },
        },
      });
    if (path.endsWith("/tokens"))
      return route.fulfill({ json: { tokens: [], total: 0 } });
    if (path.endsWith("/leaderboard"))
      return route.fulfill({ json: { traders: [], totalTraders: 0 } });
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/creator-fees/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path.endsWith("/status"))
      return route.fulfill({ json: { enabled: true, lookupAvailable: true } });
    if (path.endsWith("/recipients"))
      return route.fulfill({ json: { recipients: [], hasMore: false } });
    if (path.endsWith("/profiles"))
      return route.fulfill({ json: { profiles: [profile] } });
    if (path.endsWith("/recipients/123"))
      return route.fulfill({
        json: {
          profile,
          allocations: [
            {
              tokenId: "token-test",
              ticker: "TEST",
              name: "Test",
              shareBps: 3000,
              balanceStatus: "available",
              balances: [
                {
                  mint: "sol",
                  symbol: "SOL",
                  decimals: 9,
                  amountAtomic: "2000000",
                  totalEntitlementAtomic: "10000000",
                  claimedAtomic: "8000000",
                  pendingAtomic: "0",
                },
              ],
            },
          ],
          hasMore: false,
        },
      });
    if (path.endsWith("/leaderboard"))
      return route.fulfill({
        json: {
          creators: [
            {
              ...profile,
              rank: 1,
              feesUsd: 100,
              tokenCount: 50,
              observedTokens: 50,
              freshTokens: 50,
              balances: [
                {
                  mint: "sol",
                  symbol: "SOL",
                  decimals: 9,
                  amountAtomic: "2000000",
                  pendingAtomic: "0",
                },
              ],
            },
          ],
          hasMore: false,
          sort: url.searchParams.get("sort"),
        },
      });
    return route.fulfill({ json: {} });
  });
});
test("finds a new X creator and carries the chosen pair into an editable launch allocation", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/app");
  await page.getByRole("button", { name: /Search tokens/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search tokens" });
  await dialog
    .getByRole("combobox", { name: "Search tokens or creators" })
    .fill("@elonmusk");
  await dialog.getByRole("button", { name: "JUP", exact: true }).click();
  await dialog.getByRole("button", { name: "Find @elonmusk on X" }).click();
  const launch = dialog.getByRole("link", { name: "Launch with @elonmusk" });
  await expect(launch).toHaveAttribute(
    "href",
    "/app/create?creator=123&quote=JUP",
  );
  await launch.click();
  await expect(page).toHaveURL(/creator=123&quote=JUP/, { timeout: 20000 });
  await expect(
    page.getByText("@elonmusk", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("spinbutton").first()).toHaveValue("100");
  await page.getByRole("spinbutton").first().fill("25");
  await expect(page.getByText("75%", { exact: true })).toBeVisible();
});
test("creator rankings show total earnings and both sort modes", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/app/leaderboard");
  await expect(
    page.getByRole("button", { name: "Creators", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("group", { name: "Leaderboard type" })
      .getByRole("button")
      .first(),
  ).toHaveText("Creators");
  const board = page.getByRole("region", { name: "Creator leaderboard" });
  await expect(board.getByText("$100 earned")).toBeVisible();
  await expect(board.getByText(/to claim|unclaimed|Fees updating/)).toHaveCount(
    0,
  );
  await expect(board.getByText("50 tokens")).toBeVisible();
  const request = page.waitForRequest((r) =>
    r.url().includes("leaderboard?sort=tokens"),
  );
  await board.getByRole("button", { name: "Most tokens" }).click();
  await request;
  await expect(board.getByText("50 tokens", { exact: true })).toBeVisible();
  await expect(board.getByRole("link", { name: /Elon Musk/ })).toHaveAttribute(
    "href",
    "/app/creators/123",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("creators.png"),
    fullPage: true,
  });
});
test("Explore cards show linked X recipients and their fee split", async ({
  page,
}, info) => {
  await page.route("**/api/launchpad/tokens?*", (route) =>
    route.fulfill({
      json: {
        tokens: [
          {
            id: "card-test",
            ticker: "A+B?",
            name: "Symbol token",
            imageId: "test",
            quote: "SOL",
            mint: "11111111111111111111111111111111",
            snapshot: null,
            feeRecipients: [{ ...profile, shareBps: 7000 }],
          },
        ],
        total: 1,
      },
    }),
  );
  await page.goto("/app");
  // Changing sort requests a new client listing instead of the server seed.
  await page.getByRole("button", { name: "Newest", exact: true }).click();
  const card = page.locator(".lp-token-card").filter({ hasText: "$A+B?" });
  await expect(card.getByText("Fees to")).toBeVisible();
  await expect(
    card.getByRole("link", { name: "@elonmusk 70%" }),
  ).toHaveAttribute("href", "/app/creators/123");
  await page.screenshot({
    path: info.outputPath("card-recipients.png"),
    fullPage: true,
  });
});

test("public creator profiles show earnings and stay separate from personal claims", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/app/creator-fees?recipient=123");
  await expect(page).toHaveURL(/\/app\/creators\/123$/);
  await expect(page.getByRole("heading", { name: "@elonmusk" })).toBeVisible();
  await expect(page.getByText("0.01 SOL", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Ready to claim|Unclaimed fees|Your share/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Claim fees", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Launch with @elonmusk" }),
  ).toHaveAttribute("href", "/app/create?creator=123&quote=SOL");
  await page.screenshot({
    path: info.outputPath("creator-profile.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Creators", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Creators", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/app/creator-fees");
  await expect(
    page.getByRole("heading", { name: "Creator fees", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("@elonmusk", { exact: true })).toHaveCount(0);
});
