import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
test("compact discovery, search shortcut, and character work", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "desktop")
    await page.setViewportSize({ width: 1280, height: 720 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/launchpad/tokens?*", (route) =>
    route.fulfill({
      json: {
        total: 3,
        tokens: Array.from({ length: 3 }, (_, i) => ({
          id: `fixture-${i}`,
          ticker: `ONLY${i}`,
          name: "Test token",
          imageId: "fixture",
          quote: "SOL",
          snapshot: null,
          marketCapUsd: 12345,
          volumeUsd24h: 1234,
          volumeComplete: true,
        })),
      },
    }),
  );
  await page.route("**/api/launchpad/image/fixture", (route) =>
    route.fulfill({
      path: resolve("apps/web/public/brand/logo-128.webp"),
      contentType: "image/webp",
    }),
  );
  await page.goto("/app");
  if (process.env.UI_CSS_PREVIEW)
    await page.addStyleTag({
      path: resolve("apps/web/src/app/app/launchpad.css"),
    });
  await expect(
    page.getByRole("heading", { name: /One Ticker, No Copies/ }),
  ).toBeVisible();
  await expect(page.locator(".lp-pair-filters button")).toHaveText([
    "All",
    "SOL",
  ]);
  await expect(page.locator(".lp-token-card")).toHaveCount(3);
  if (testInfo.project.name === "desktop") {
    const card = await page.locator(".lp-token-card").first().boundingBox();
    expect(card!.y + card!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    await page.keyboard.press("Control+k");
    await expect(
      page.getByRole("combobox", {
        name: "Search name, ticker, or contract address",
      }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Make the degen pee" }).click();
  await expect(page.locator(".lp-pee-character img")).toHaveAttribute(
    "src",
    "/scene/pissing-320.webp",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("discovery.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("creation accepts decimal commas, keeps the ticker focus together, and defaults to SOL payment", async ({
  page,
}, testInfo) => {
  await page.route("**/api/launchpad/config", (route) =>
    route.fulfill({
      json: {
        quotes: [
          { symbol: "SOL", enabled: true, displayUsdPrice: 100 },
          { symbol: "SPYX", enabled: true, displayUsdPrice: 750 },
        ],
        prices: { SOL: 100, SPYX: 750 },
      },
    }),
  );
  await page.route("**/api/launchpad/ticker?*", (route) =>
    route.fulfill({ json: { available: true } }),
  );
  await page.goto("/app/create");
  await expect(page.getByLabel(/^Amount/)).toHaveCount(0);
  await expect(
    page.getByText(/Anyone can make the first purchase/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add a first buy" }).click();
  await page.getByRole("combobox", { name: "Pair with", exact: true }).click();
  await page.getByRole("option", { name: /^SPYX/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Pay with", exact: true }),
  ).toContainText("SOL");
  await page.getByLabel(/^Amount \(SOL\)/).fill("0,1");
  await expect(page.getByText("≈ $10.00 reference value")).toBeVisible();
  await page.getByRole("combobox", { name: "Pay with", exact: true }).click();
  await page.getByRole("option", { name: /^SPYX/ }).click();
  await page.getByLabel(/^Amount \(SPYX\)/).fill("0,004");
  await expect(page.getByText("≈ $3.00 reference value")).toBeVisible();
  await page.getByLabel(/^Amount \(SPYX\)/).fill("invalid");
  await expect(page.getByText(/NaN/)).toHaveCount(0);
  await page.getByPlaceholder("YOURS", { exact: true }).focus();
  expect(
    await page
      .locator(".lp-input-prefix")
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("none");
  expect(
    await page
      .getByPlaceholder("YOURS", { exact: true })
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("none");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("creation.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Remove first buy" }).click();
  await expect(page.getByLabel(/^Amount/)).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Pay with", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Slippage tolerance" }),
  ).toHaveCount(0);
});
test("comments remain readable and posting is gated", async ({ page }) => {
  await page.route("**/api/launchpad/token/comment-fixture", (route) =>
    route.fulfill({
      json: {
        id: "comment-fixture",
        mint: "FixtureMint",
        creator: "FixtureCreator",
        pool: "FixturePool",
        description: "Isolated fixture",
        ticker: "ONLY",
        name: "Fixture",
        quote: "SOL",
        imageId: "fixture",
        trades: [],
        snapshot: null,
      },
    }),
  );
  await page.route("**/api/launchpad/candles/comment-fixture?*", (route) =>
    route.fulfill({ json: { candles: [] } }),
  );
  await page.route("**/api/launchpad/comments/comment-fixture", (route) =>
    route.fulfill({
      json: {
        comments: [
          {
            id: "one",
            wallet: "fixtureWallet",
            profile: { username: "verified_trader", avatar: null },
            body: "<script>alert('test')</script> A trader's take.",
            purchaseSignature: "receipt",
            createdAt: "2026-09-15T12:00:00Z",
          },
        ],
        next: null,
      },
    }),
  );
  await page.goto("/app/token/comment-fixture");
  await expect(
    page.getByRole("heading", { name: "The trading floor" }),
  ).toBeVisible();
  await expect(
    page.getByText("<script>alert('test')</script> A trader's take."),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Your comment" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect to post", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "@verified_trader" }),
  ).toHaveAttribute("href", "https://x.com/verified_trader");
  await page.getByRole("textbox", { name: "Your comment" }).fill("My take");
  await expect(
    page.getByRole("button", { name: "Connect to post", exact: true }),
  ).toBeEnabled();
});

test("a confirmed SOL conversion resumes at the second approval after reload", async ({
  page,
}) => {
  const { createRequire } = await import("node:module");
  const require = createRequire(resolve("apps/web/package.json"));
  const payer = require("@solana/web3.js").Keypair.generate();
  const address = payer.publicKey.toBase58();
  await page.addInitScript(
    ({ address, publicKey }) => {
      const account = {
        address,
        publicKey: new Uint8Array(publicKey),
        chains: ["solana:mainnet"],
        features: ["solana:signTransaction"],
      };
      const wallet = {
        name: "Resume Test Wallet",
        version: "1.0.0",
        icon: "data:image/svg+xml;base64,PHN2Zy8+",
        chains: ["solana:mainnet"],
        accounts: [account],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => ({ accounts: [account] }),
          },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async () => {
              throw new Error("Signing disabled in resume test");
            },
          },
        },
      };
      localStorage.setItem("walletName", JSON.stringify(wallet.name));
      sessionStorage.setItem(
        "oneonly-intent-mainnet-beta",
        "conversion-fixture",
      );
      window.addEventListener("wallet-standard:app-ready", ((
        event: CustomEvent,
      ) => event.detail.register(wallet)) as EventListener);
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: (api: { register: (wallet: unknown) => void }) =>
            api.register(wallet),
        }),
      );
    },
    { address, publicKey: Array.from(payer.publicKey.toBytes()) as number[] },
  );
  let continuation = "";
  await page.route("**/api/launchpad/**", (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/launchpad/",
    )[1];
    if (path === "session") return route.fulfill({ json: { wallet: address } });
    if (path === "intent/conversion-fixture")
      return route.fulfill({
        json: {
          id: "conversion-fixture",
          kind: "launch-conversion",
          status: "confirmed",
          details: {
            network: "mainnet-beta",
            action: "Step 1 of 2 · convert SOL to SPYX",
          },
        },
      });
    if (path === "continue-launch") {
      continuation = route.request().postDataJSON().id;
      return route.fulfill({
        json: {
          id: "launch-fixture",
          kind: "launch",
          status: "prepared",
          details: {
            network: "mainnet-beta",
            ticker: "TEST",
            input: "0.01 SPYX",
          },
        },
      });
    }
    if (path === "config")
      return route.fulfill({
        json: {
          quotes: [{ symbol: "SOL", enabled: true, displayUsdPrice: 100 }],
          prices: { SOL: 100 },
        },
      });
    return route.fulfill({
      status: 400,
      json: { error: "Unexpected test request" },
    });
  });
  await page.goto("/app/create");
  await expect(page.locator(".wallet-adapter-button-trigger")).toContainText(
    address.slice(0, 4),
  );
  await page
    .getByRole("button", { name: "Continue to launch · step 2" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("0.01 SPYX");
  expect(continuation).toBe("conversion-fixture");
  await expect(
    page.getByRole("button", { name: "Approve in wallet", exact: true }),
  ).toBeVisible();
});
