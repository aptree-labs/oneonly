import { test, expect } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Opt-in, read-only checks. Never creates a token, signs a transaction, or spends funds.
test.skip(
  !process.env.MAINNET_CHECK_URL,
  "Set MAINNET_CHECK_URL for mainnet release checks.",
);
test("a remembered browser wallet hydrates without replacing the server HTML", async ({
  page,
}) => {
  const require = createRequire(resolve("apps/web/package.json"));
  const publicKey = generateKeyPairSync("ed25519")
    .publicKey.export({ format: "der", type: "spki" })
    .subarray(-32);
  const walletAddress = require("bs58").default.encode(publicKey);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ walletAddress, publicKey }) => {
      const account = {
        address: walletAddress,
        publicKey: new Uint8Array(publicKey),
        chains: ["solana:mainnet"],
        features: ["solana:signTransaction"],
      };
      const wallet = {
        name: "Review Test Wallet",
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
              throw new Error("Signing disabled in UI regression");
            },
          },
        },
      };
      localStorage.setItem("walletName", JSON.stringify(wallet.name));
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
    { walletAddress, publicKey: Array.from(publicKey) },
  );
  await page.goto(`${process.env.MAINNET_CHECK_URL}/app/create`);
  await expect(
    page.getByRole("heading", { name: "Ready to send it?" }),
  ).toBeVisible();
  await expect(page.locator(".wallet-adapter-button-trigger")).toContainText(
    walletAddress.slice(0, 4),
  );
  expect(errors).toEqual([]);
});
test("mainnet discovery uses real mints, empty launch gates, and the correct wallet network", async ({
  page,
  request,
}) => {
  const base = process.env.MAINNET_CHECK_URL!;
  const response = await request.get(`${base}/api/launchpad/config`);
  expect(response.ok()).toBe(true);
  const config = await response.json();
  expect(config.network).toBe("mainnet-beta");
  const health = await request.get(`${base}/api/launchpad/health`);
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({
    network: "mainnet-beta",
    rpcVerified: true,
  });
  expect(
    config.quotes.find((q: { symbol: string }) => q.symbol === "USDC").mint,
  ).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  expect(
    config.quotes.filter((q: { category: string }) => q.category === "Stocks"),
  ).toHaveLength(5);
  for (const asset of config.quotes) {
    if (!asset.config || asset.unavailableReason)
      expect(asset.enabled).toBe(false);
  }
  await page.goto(`${base}/app`);
  await expect(page.locator(".lp-mobile-network")).toHaveText("MAINNET");
  await expect(page.locator(".lp-network")).toContainText("MAINNET");
  await expect(page.locator("body")).not.toContainText("DEVNET");
  await page.goto(`${base}/app/setup`);
  await expect(
    page.getByRole("heading", { name: "Mainnet setup." }),
  ).toBeVisible();
  if (process.env.CHECK_STOCK_SETUP === "1") {
    await expect(
      page.getByRole("heading", { name: "Five stock configurations" }),
    ).toBeVisible();
    for (const symbol of ["SPYX", "QQQX", "NVDAX", "TSLAX", "CRCLX"]) {
      const button = page.getByRole("button", {
        name: `Review ${symbol} configuration`,
      });
      await expect(button).toBeEnabled();
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeVisible();
    }
    await expect(
      page.getByText("Configuration installed. No additional setup needed."),
    ).toHaveCount(2);
  }
  if (process.env.CHECK_STOCK_INSTALLED === "1") {
    await expect(
      page.getByText("Configuration installed. No additional setup needed."),
    ).toHaveCount(7);
    await expect(
      page.getByRole("button", { name: /Review .* configuration/ }),
    ).toHaveCount(0);
    const stocks = config.quotes.filter(
      (asset: { category: string }) => asset.category === "Stocks",
    );
    for (const stock of stocks) {
      expect(stock.config).toBeTruthy();
      expect(stock.enabled).toBe(process.env.CHECK_STOCK_ENABLED === "1");
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const submission = await request.post(`${base}/api/launchpad/setup`, {
    headers: { origin: new URL(base).origin },
    data: { symbol: "SOL" },
  });
  expect([401, 403]).toContain(submission.status());
});

test("stock trades offer SOL and stock settlement on desktop and mobile", async ({
  page,
}) => {
  const base = process.env.MAINNET_CHECK_URL!;
  await page.route("**/api/launchpad/token/stock-ui-fixture", (route) =>
    route.fulfill({
      json: {
        id: "stock-ui-fixture",
        ticker: "TEST",
        name: "Stock UI fixture",
        description: "Read-only browser fixture",
        imageId: "fixture",
        mint: "FixtureMint",
        quote: "SPYX",
        quoteMultiplier: 1.005,
        creator: "FixtureCreator",
        status: "active",
        stale: false,
        trades: [],
        snapshot: {
          graduated: false,
          readyToMigrate: false,
          marketVenue: "dbc",
          priceQuote: "0.000001",
          marketCapQuote: "1000",
          quoteReserve: "1",
          progress: 5,
          creatorQuoteFee: "0",
        },
      },
    }),
  );
  await page.route("**/api/launchpad/candles/stock-ui-fixture?*", (route) =>
    route.fulfill({
      json: {
        candles: [],
        hasMore: false,
        graduated: false,
        quoteMultiplier: 1.005,
      },
    }),
  );
  await page.route("**/api/launchpad/image/fixture", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto(`${base}/app/token/stock-ui-fixture`);
  await expect(
    page.getByRole("combobox", { name: "Pay with", exact: true }),
  ).toContainText("SOL");
  await page.getByRole("combobox", { name: "Pay with", exact: true }).click();
  await page.getByRole("option", { name: /SPYX/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Pay with", exact: true }),
  ).toContainText("SPYX");
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Receive", exact: true }),
  ).toContainText("SPYX");
  await page.getByRole("combobox", { name: "Receive", exact: true }).click();
  await page.getByRole("option", { name: /SOL/ }).click();
  await expect(
    page.getByRole("textbox", { name: "You sell", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("link", { name: "Early access site" }),
  ).toHaveCount(0);
});
