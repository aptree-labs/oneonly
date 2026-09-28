import { test, expect } from "@playwright/test";

test("a creator can link X without losing the launch draft or uploading before the link", async ({
  page,
}) => {
  test.setTimeout(90000);
  const address = "11111111111111111111111111111111";
  await page.addInitScript(() => {
    const account = {
      address: "11111111111111111111111111111111",
      publicKey: new Uint8Array(32),
      chains: ["solana:mainnet"],
      features: ["solana:signTransaction"],
    };
    const wallet = {
      name: "Launch test wallet",
      version: "1.0.0",
      icon: "data:image/svg+xml;base64,PHN2Zy8+",
      chains: account.chains,
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
            throw new Error("This test never signs transactions");
          },
        },
      },
    };
    localStorage.setItem("walletName", JSON.stringify(wallet.name));
    window.addEventListener("wallet-standard:app-ready", (event) =>
      (event as CustomEvent).detail.register(wallet),
    );
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", {
        detail: (api: { register: (w: unknown) => void }) =>
          api.register(wallet),
      }),
    );
  });
  let linked = false,
    uploads = 0;
  let launch: Record<string, unknown> | undefined;
  await page.route("**/api/launchpad/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/launchpad/",
    )[1];
    if (path === "config")
      return route.fulfill({
        json: {
          quotes: [{ symbol: "SOL", enabled: true, creationEnabled: true }],
          prices: { SOL: 100 },
        },
      });
    if (path === "ticker") return route.fulfill({ json: { available: true } });
    if (path === "session") return route.fulfill({ json: { wallet: address } });
    if (path === "profile")
      return route.fulfill({
        json: {
          wallet: address,
          available: true,
          profile: linked ? { username: "creator", avatar: null } : null,
        },
      });
    if (path === "link-x") {
      expect(route.request().postDataJSON()).toEqual({
        tokenId: "",
        returnTo: "/app/create",
      });
      return route.fulfill({
        json: { url: new URL("/test-x-oauth", page.url()).href },
      });
    }
    if (path === "image") {
      uploads++;
      return route.fulfill({ json: { id: "uploaded-image" } });
    }
    if (path === "launch") {
      launch = route.request().postDataJSON();
      return route.fulfill({
        status: 400,
        json: { error: "Test stopped before preparing a transaction." },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/creator-fees/status", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        network: "mainnet-beta",
        lookupAvailable: true,
        bindingAvailable: true,
        escrowAvailable: true,
      },
    }),
  );
  await page.route("**/api/creator-fees/profiles?*", (r) =>
    r.fulfill({
      json: {
        profiles: [
          {
            xId: "123",
            username: "recipient",
            name: "Recipient",
            avatar: null,
          },
        ],
      },
    }),
  );
  await page.route("**/test-x-oauth", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<p>Mock X authorization</p>",
    }),
  );
  await page.goto("/app/create");
  await expect(
    page.locator(".wallet-adapter-button-trigger"),
  ).not.toContainText("Select Wallet");
  await page
    .getByRole("textbox", { name: "Token name", exact: true })
    .fill("My draft");
  await page.getByRole("textbox", { name: /^Ticker/ }).fill("DRAFT");
  await page.getByLabel("Token image", { exact: true }).setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        canvas.getContext("2d")!.fillRect(0, 0, 32, 32);
        return canvas.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    ),
  });
  await expect(page.getByAltText("Token image preview")).toBeVisible();
  await page.getByRole("button", { name: /Share creator fees/ }).click();
  await page
    .getByRole("textbox", { name: "Find an X account" })
    .fill("recipient");
  await page.getByRole("button", { name: /Recipient @recipient/ }).click();
  await page
    .getByRole("spinbutton", { name: "Share for @recipient" })
    .fill("20");
  await expect(
    page.getByText(/Link your X account to this wallet before launching/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review launch" }).click();
  await expect(
    page.getByText(/Connect X in Share creator fees to receive/),
  ).toBeVisible();
  expect(uploads).toBe(0);
  expect(launch).toBeUndefined();
  await page
    .locator(".cf-editor")
    .getByRole("button", { name: "Connect X account" })
    .click();
  await expect(page).toHaveURL(/\/test-x-oauth$/);
  linked = true;
  await page.goto("/app/create?x=linked");
  await expect(
    page.getByRole("textbox", { name: "Token name", exact: true }),
  ).toHaveValue("My draft");
  await expect(page.getByRole("textbox", { name: /^Ticker/ })).toHaveValue(
    "DRAFT",
  );
  await expect(page.getByAltText("Token image preview")).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Share for @recipient" }),
  ).toHaveValue("20");
  await expect(
    page
      .locator(".cf-editor")
      .getByRole("link", { name: "X profile @creator" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review launch" }).click();
  await expect(
    page.getByText("Test stopped before preparing a transaction."),
  ).toBeVisible();
  expect(uploads).toBe(1);
  expect(launch).toMatchObject({
    ticker: "DRAFT",
    name: "My draft",
    initialBuy: "0",
    quote: "SOL",
    feeRecipients: [{ xId: "123", shareBps: 2000 }],
  });
});
