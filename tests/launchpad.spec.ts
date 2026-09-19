import { test, expect } from "@playwright/test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
test("a full curve exposes graduation on mobile and a graduated pool keeps buy/sell available", async ({
  page,
}) => {
  let graduated = false;
  await page.route("**/api/launchpad/token/graduation-fixture", (route) =>
    route.fulfill({
      json: {
        id: "graduation-fixture",
        ticker: "GRAD",
        name: "Graduation fixture",
        description: "Isolated browser fixture",
        imageId: "fixture",
        mint: "FixtureMint",
        quote: "SOL",
        creator: "FixtureCreator",
        status: "active",
        stale: false,
        trades: [],
        snapshot: {
          graduated,
          readyToMigrate: !graduated,
          marketVenue: graduated ? "damm-v2" : "dbc",
          dammPool: graduated ? "GraduatedPool" : null,
          priceQuote: "0.0000001",
          marketCapQuote: "100",
          quoteReserve: "1",
          progress: 100,
          creatorQuoteFee: "0",
        },
      },
    }),
  );
  await page.route("**/api/launchpad/candles/graduation-fixture?*", (route) =>
    route.fulfill({
      json: {
        candles: [],
        hasMore: false,
        graduated,
        graduatedHistory: graduated,
      },
    }),
  );
  await page.route("**/api/launchpad/image/fixture", (route) =>
    route.fulfill({
      path: resolve("apps/web/public/brand/logo-128.webp"),
      contentType: "image/webp",
    }),
  );
  await page.goto("/app/token/graduation-fixture");
  await expect(
    page.getByRole("button", { name: "Review graduation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Buy GRAD", exact: true }),
  ).toHaveCount(0);
  graduated = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Buy GRAD", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("A whole new market.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sell GRAD", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const bs58 = require("bs58").default;
const headers = {
  origin: new URL(process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000")
    .origin,
};
test("app discovery, creation, and wallet pages work without invented market data", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/launchpad/tokens*", (route) =>
    route.fulfill({ json: { tokens: [] } }),
  );
  await page.goto("/app");
  await expect(
    page.getByRole("heading", {
      name: "One Ticker, No Copies,Pair with anything",
    }),
  ).toBeVisible();
  await expect(page.getByText("Unclaimed territory.")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Launch a token" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Ready to send it?" }),
  ).toBeVisible();
  await page.getByPlaceholder("YOURS", { exact: true }).fill("$ TEST");
  await expect(page.getByText("Available", { exact: true })).toBeVisible();
  await page.getByPlaceholder("YOURS", { exact: true }).fill("ſOL");
  await expect(
    page.getByText("Use ASCII letters and numbers only."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Your wallet", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make yourself known." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("wallet auth verifies signatures, consumes nonces once, and requires same-origin writes", async ({
  request,
}) => {
  const keys = generateKeyPairSync("ed25519"),
    wallet = bs58.encode(
      keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    );
  const denied = await request.post("/api/launchpad/challenge", {
    data: { wallet },
    headers: { origin: "https://elsewhere.invalid" },
  });
  expect(denied.status()).toBe(403);
  const response = await request.post("/api/launchpad/challenge", {
    data: { wallet },
    headers,
  });
  expect(response.status()).toBe(200);
  const nonce = await response.json();
  const signature = bs58.encode(
    sign(null, Buffer.from(nonce.message), keys.privateKey),
  );
  expect(
    (
      await request.post("/api/launchpad/verify", {
        data: { id: nonce.id, signature },
        headers,
      })
    ).status(),
  ).toBe(200);
  expect(await (await request.get("/api/launchpad/session")).json()).toEqual({
    wallet,
  });
  expect(
    (
      await request.post("/api/launchpad/verify", {
        data: { id: nonce.id, signature },
        headers,
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/launchpad/launch", { data: {}, headers })
    ).status(),
  ).toBe(400);
  await request.post("/api/launchpad/logout", { data: {}, headers });
  expect(await (await request.get("/api/launchpad/session")).json()).toEqual({
    wallet: null,
  });
  expect(
    (
      await request.post("/api/launchpad/trade", { data: {}, headers })
    ).status(),
  ).toBe(401);
});

test("discovery defaults to volume and offers the requested sorts, quote groups, and contract search", async ({
  page,
}) => {
  const fixtures = [
    {
      id: "volume",
      ticker: "VOL",
      name: "Volume fixture",
      mint: "VolumeContract123",
      quote: "SOL",
      marketCapUsd: 200,
      volumeUsd24h: 1000,
      volumeComplete: true,
      imageId: "fixture",
      snapshot: { graduated: false, progress: 15 },
    },
    {
      id: "cap",
      ticker: "CAP",
      name: "Cap fixture",
      mint: "CapContract123",
      quote: "USDC",
      marketCapUsd: 500,
      volumeUsd24h: 100,
      volumeComplete: true,
      imageId: "fixture",
      snapshot: { graduated: false, progress: 50 },
    },
    {
      id: "grad",
      ticker: "GRAD",
      name: "Graduated fixture",
      mint: "GraduatedContract123",
      quote: "SOL",
      marketCapUsd: null,
      volumeUsd24h: null,
      imageId: "fixture",
      snapshot: { graduated: true, progress: 100 },
    },
  ];
  await page.route("**/api/launchpad/image/fixture", (route) =>
    route.fulfill({
      path: resolve("apps/web/public/brand/logo-128.webp"),
      contentType: "image/webp",
    }),
  );
  await page.route("**/api/launchpad/tokens*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    let tokens = [...fixtures];
    if (params.get("sort") === "market-cap")
      tokens = [fixtures[1], fixtures[0], fixtures[2]];
    if (params.get("sort") === "newest") tokens = [...fixtures].reverse();
    const pair = params.get("pair");
    if (pair !== "All") tokens = tokens.filter((token) => token.quote === pair);
    if (params.get("search"))
      tokens = tokens.filter((token) =>
        token.mint.toLowerCase().includes(params.get("search")!.toLowerCase()),
      );
    return route.fulfill({
      json: { tokens, total: tokens.length, page: 0, pageSize: 24 },
    });
  });
  await page.goto("/app");
  await expect(
    page.getByRole("button", { name: "24h Volume", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".lp-token-card").first()).toContainText("$VOL");
  await expect(
    page.locator(".lp-stamp", { hasText: "GRADUATED" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Market Cap", exact: true }).click();
  await expect(page.locator(".lp-token-card").first()).toContainText("$CAP");
  await page.getByRole("button", { name: "Newest", exact: true }).click();
  await expect(page.locator(".lp-token-card").first()).toContainText("$GRAD");
  await page
    .getByRole("group", { name: "Paired with" })
    .getByRole("button", { name: "USDC", exact: true })
    .click();
  await expect(page.locator(".lp-token-card")).toHaveCount(1);
  await page
    .getByRole("group", { name: "Paired with" })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search tokens" })
    .fill("CapContract123");
  await expect(page.locator(".lp-token-card")).toHaveCount(1);
  await expect(page.locator(".lp-token-card")).toContainText("$CAP");
  await page.getByRole("textbox", { name: "Search tokens" }).fill("");
  await page.getByRole("button", { name: "Stocks", exact: true }).click();
  await expect(page.getByText("No stock-paired tokens yet.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Make the first move" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search tokens" }).fill("missing");
  await expect(page.getByText("No matching tokens.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search tokens" }).fill("");
  await page.getByRole("button", { name: "Tokens", exact: true }).click();
  await expect(page.getByText("No token-paired launches yet.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("TradingView line charts render indexed data, switch timeframes, recover from errors, and expose accessible values", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/launchpad/token/chart-fixture", (route) =>
    route.fulfill({
      json: {
        id: "chart-fixture",
        ticker: "CHART",
        name: "Chart fixture",
        quote: "SOL",
        mint: "FixtureMint",
        imageId: "fixture",
        creator: "FixtureCreator",
        status: "active",
        description: "Isolated browser chart test",
        trades: [],
        stale: false,
        snapshot: {
          marketCapQuote: "30",
          priceQuote: "0.00000003",
          quoteReserve: "0.1",
          progress: 1,
          creatorQuoteFee: "0",
          graduated: false,
        },
      },
    }),
  );
  await page.route("**/api/launchpad/image/fixture", (route) =>
    route.fulfill({
      path: resolve("apps/web/public/brand/logo-128.webp"),
      contentType: "image/webp",
    }),
  );
  let fail = false;
  await page.route("**/api/launchpad/candles/chart-fixture?*", (route) => {
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "Chart test outage" },
      });
    const interval = new URL(route.request().url()).searchParams.get(
      "interval",
    );
    return route.fulfill({
      json: {
        interval,
        hasMore: false,
        from: 1789196400,
        through: "2026-09-12T11:03:00Z",
        candles: [
          {
            time: 1789200000,
            open: "0.00000002",
            high: "0.00000004",
            low: "0.00000001",
            close: "0.00000003",
            volume: "0.15",
            trades: 4,
          },
          ...(interval === "1h"
            ? []
            : [
                {
                  time: 1789200450,
                  open: "0.00000003",
                  high: "0.000000045",
                  low: "0.00000003",
                  close: "0.00000004",
                  volume: "0.1",
                  trades: 2,
                },
                {
                  time: 1789200900,
                  open: "0.00000003",
                  high: "0.000000035",
                  low: "0.000000025",
                  close: "0.000000025",
                  volume: "0.2",
                  trades: 3,
                },
              ]),
        ],
      },
    });
  });
  await page.goto("/app/token/chart-fixture");
  await expect(
    page.getByText("3 price points · UTC", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lp-candle-canvas canvas").first()).toBeVisible();
  await expect(
    page.getByLabel("Interactive line chart with volume bars"),
  ).toBeVisible();
  await expect(
    page.getByLabel("Chart price", { exact: true }).locator("strong"),
  ).toHaveText("$0.000000025 USD");
  await expect(page.getByLabel("Chart price", { exact: true })).toContainText(
    "-16.67%",
  );
  await expect(page.locator(".lp-candle-canvas #tv-attr-logo")).toHaveCount(0);
  await page.locator(".lp-chart-panel").screenshot({
    path: `/tmp/oneonly-smooth-chart-${test.info().project.name}.png`,
  });
  await page.getByText("View chart data", { exact: true }).click();
  await expect(page.locator(".lp-candle-accessible tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "1h", exact: true }).click();
  await expect(
    page.getByText("1 price point · UTC", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fit chart", exact: true }).click();
  await page
    .locator(".lp-chart-panel")
    .screenshot({ path: `/tmp/oneonly-chart-${test.info().project.name}.png` });
  fail = true;
  await page.getByRole("button", { name: "4h", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Chart test outage" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry chart", exact: true }).click();
  await expect(
    page.getByText("3 price points · UTC", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Chart credits",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
