import { expect, test } from "@playwright/test";
test.setTimeout(90000);
const profile = {
  xId: "100",
  username: "demo_creator",
  name: "Demo creator",
  avatar: null,
};
async function fixtures(
  page: import("@playwright/test").Page,
  escrowAvailable = false,
) {
  await page.route("**/api/creator-fees/status", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        network: "devnet",
        lookupAvailable: true,
        bindingAvailable: true,
        escrowAvailable,
      },
    }),
  );
  await page.route("**/api/creator-fees/profiles?*", (r) =>
    r.fulfill({ json: { profiles: [profile] } }),
  );
  await page.route("**/api/launchpad/config", (r) =>
    r.fulfill({
      json: {
        quotes: [{ symbol: "SOL", enabled: true }],
        prices: { SOL: 100 },
      },
    }),
  );
  await page.route("**/api/launchpad/ticker?*", (r) =>
    r.fulfill({ json: { available: true } }),
  );
}
test("fee allocations block unavailable launches and require exactly 100 percent", async ({
  page,
}) => {
  await fixtures(page, true);
  await page.goto("/app/create");
  await page.getByPlaceholder("YOURS", { exact: true }).fill("EXAMPLE");
  await expect(
    page.getByRole("button", { name: "Review launch" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /Share creator fees/ }).click();
  await expect(
    page.getByRole("button", { name: "Review launch" }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Find an X account" })
    .fill("demo_creator");
  await page
    .getByRole("button", { name: /Demo creator @demo_creator/ })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Share for @demo_creator" }),
  ).toHaveValue("100");
  await expect(
    page.getByRole("button", { name: "Review launch" }),
  ).toBeEnabled();
  await page
    .getByRole("spinbutton", { name: "Share for @demo_creator" })
    .fill("80");
  await expect(
    page.getByRole("button", { name: "Review launch" }),
  ).toBeDisabled();
  await expect(page.getByText("80% / 100%")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("allocation-editor.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /Share creator fees/ }).click();
  await expect(
    page.getByRole("button", { name: "Review launch" }),
  ).toBeEnabled();
});
test("missing escrow readiness cannot enable sharing and public recipients show unavailable balances honestly", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/creator-fees/recipients/100*", (r) =>
    r.fulfill({
      json: {
        profile,
        allocations: [
          {
            tokenId: "demo",
            ticker: "DEMO",
            name: "Demo token",
            shareBps: 2500,
            balances: [],
            balanceStatus: "unavailable",
          },
        ],
        hasMore: false,
      },
    }),
  );
  await page.goto("/app/create");
  await page.getByPlaceholder("YOURS", { exact: true }).fill("EXAMPLE");
  await page.getByRole("button", { name: /Share creator fees/ }).click();
  await page
    .getByRole("textbox", { name: "Find an X account" })
    .fill("demo_creator");
  await page
    .getByRole("button", { name: /Demo creator @demo_creator/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Review launch" }),
  ).toBeDisabled();
  await expect(page.getByText(/Fee sharing is being prepared/)).toBeVisible();
  await page.goto("/app/creator-fees?recipient=100");
  await expect(page.getByText("@demo_creator", { exact: true })).toBeVisible();
  await expect(page.getByText("25% creator share")).toBeVisible();
  await expect(
    page.getByText("Unclaimed fees unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Claim fees", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("recipient-dashboard.png"),
    fullPage: true,
  });
});

test("a linked recipient must verify a new post before a claim can proceed", async ({
  page,
}) => {
  const wallet = "11111111111111111111111111111111";
  await page.addInitScript(() => {
    const account = {
      address: "11111111111111111111111111111111",
      publicKey: new Uint8Array(32),
      chains: ["solana:devnet"],
      features: ["solana:signMessage", "solana:signTransaction"],
    };
    const wallet = {
      version: "1.0.0",
      name: "Fee test wallet",
      icon: "data:image/svg+xml;base64,PHN2Zy8+",
      chains: ["solana:devnet"],
      accounts: [account],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => ({ accounts: [account] }),
        },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signMessage": { version: "1.0.0", signMessage: async () => [] },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: async () => {
            throw new Error("Test must never sign a transaction");
          },
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) =>
      (event as CustomEvent).detail.register(wallet),
    );
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", {
        detail: (api: { register: (wallet: unknown) => void }) =>
          api.register(wallet),
      }),
    );
  });
  await fixtures(page, true);
  await page.route("**/api/launchpad/session", (r) =>
    r.fulfill({ json: { wallet } }),
  );
  await page.route("**/api/creator-fees/me*", (r) =>
    r.fulfill({
      json: {
        wallet,
        profile,
        binding: { xId: profile.xId, wallet },
        allocations: [
          {
            tokenId: "demo",
            ticker: "DEMO",
            name: "Demo token",
            shareBps: 2500,
            balances: [
              {
                mint: "mint",
                symbol: "SOL",
                decimals: 9,
                amountAtomic: "1000000000",
                pendingAtomic: "0",
              },
            ],
            balanceStatus: "available",
          },
        ],
        hasMore: false,
      },
    }),
  );
  await page.route("**/api/creator-fees/challenges", (r) =>
    r.fulfill({
      json: {
        id: "challenge-test",
        postText: "Claiming my DEMO creator fees. Code: staging-test",
        composeUrl: "https://x.com/intent/post?text=staging-test",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        status: "pending",
      },
    }),
  );
  await page.route("**/api/creator-fees/verify", (r) =>
    r.fulfill({ json: { verified: true, claimReady: false } }),
  );
  let claims = 0;
  await page.route("**/api/creator-fees/claim", (r) => {
    claims++;
    return r.fulfill({ status: 503, json: { error: "Unavailable" } });
  });
  await page.goto("/app/creator-fees");
  await page
    .getByRole("button", { name: "Select Wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /Fee test wallet/ }).click();
  await expect(
    page.getByRole("button", { name: "Claim fees", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Claim fees", exact: true }).click();
  await expect(page.getByRole("link", { name: "Post on X" })).toHaveAttribute(
    "href",
    "https://x.com/intent/post?text=staging-test",
  );
  await expect(
    page.getByRole("button", { name: "Verify post", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Post link", exact: true })
    .fill("https://x.com/demo_creator/status/123");
  await page.getByRole("button", { name: "Verify post", exact: true }).click();
  await expect(page.getByText("Post verified", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Claiming not available yet" }),
  ).toBeDisabled();
  expect(claims).toBe(0);
  await page.screenshot({
    path: test.info().outputPath("verified-post-claim-gate.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Escrow readiness alone must not enable a claim without X post verification.
  await page.route("**/api/creator-fees/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        network: "devnet",
        escrowAvailable: true,
        lookupAvailable: false,
        bindingAvailable: true,
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Claim fees", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("X post verification is not available yet. Fee claims are paused."),
  ).toBeVisible();
  expect(claims).toBe(0);

});

test("recipient rankings keep different assets separate and mark partial coverage", async ({
  page,
}) => {
  await fixtures(page, true);
  await page.route("**/api/launchpad/leaderboard?*", (r) =>
    r.fulfill({
      json: {
        period: "24h",
        asOf: new Date().toISOString(),
        totalTraders: 0,
        traders: [],
      },
    }),
  );
  await page.route("**/api/creator-fees/recipients?*", (r) =>
    r.fulfill({
      json: {
        recipients: [
          {
            ...profile,
            tokenCount: 3,
            balanceStatus: "partial",
            lastUpdated: "2026-09-26T10:00:00Z",
            coverage: { fresh: 1, observed: 2, total: 3 },
            balances: [
              {
                mint: "sol",
                symbol: "SOL",
                decimals: 9,
                amountAtomic: "1000000000",
                pendingAtomic: "500000000",
              },
              {
                mint: "usdc",
                symbol: "USDC",
                decimals: 6,
                amountAtomic: "2000000",
                pendingAtomic: "0",
              },
            ],
          },
        ],
        hasMore: false,
      },
    }),
  );
  await page.goto("/app/leaderboard");
  await page
    .getByRole("button", { name: "Fee recipients", exact: true })
    .click();
  const recipient = page.locator(".cf-recipient-row");
  await expect(recipient).toContainText("3 tokens");
  await expect(recipient).toContainText("1.5 SOL · 2 USDC");
  await expect(recipient).toContainText("Last known · partial");
  await expect(recipient).toHaveAttribute(
    "href",
    "/app/creator-fees?recipient=100",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("X readiness remains visible when escrow is ready", async ({ page }) => {
  await fixtures(page, true);
  await page.route("**/api/creator-fees/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        network: "devnet",
        escrowAvailable: true,
        lookupAvailable: false,
        bindingAvailable: false,
      },
    }),
  );
  await page.goto("/app/create");
  await page.getByRole("button", { name: /Share creator fees/ }).click();
  await expect(
    page.getByText("X account search is not available yet."),
  ).toBeVisible();
  await expect(
    page.getByText("X account linking is not available yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Find an X account" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add my connected X account" }),
  ).toBeDisabled();
  await page.goto("/app/creator-fees");
  await expect(
    page.getByText(
      "X post verification is not available yet. Fee claims are paused.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("X account linking is not available yet."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Connect X in the top bar, then refresh to find your allocations.",
    ),
  ).toHaveCount(0);
});
