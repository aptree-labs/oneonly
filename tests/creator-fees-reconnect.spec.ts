import { expect, test } from "@playwright/test";

test("stale X ownership has a reconnect path back to explicit wallet binding", async ({
  page,
}) => {
  test.setTimeout(90000);
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
      name: "Reconnect test wallet",
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
            throw new Error("This test must never sign a transaction");
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
  const profile = {
    xId: "100",
    username: "test_creator",
    name: "Test creator",
    avatar: null,
  };
  let binding: null | { xId: string; wallet: string } = null;
  let reconnected = false;
  let bindCalls = 0;
  let reconnectBody: unknown;
  await page.route("**/api/creator-fees/status", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        network: "devnet",
        escrowAvailable: true,
        lookupAvailable: true,
        bindingAvailable: true,
      },
    }),
  );
  await page.route("**/api/launchpad/session", (r) =>
    r.fulfill({ json: { wallet } }),
  );
  await page.route("**/api/launchpad/profile", (r) =>
    r.fulfill({ json: { wallet, profile } }),
  );
  await page.route("**/api/creator-fees/me*", (r) =>
    r.fulfill({
      json: { wallet, profile, binding, allocations: [], hasMore: false },
    }),
  );
  await page.route("**/api/creator-fees/bind", (r) => {
    bindCalls++;
    if (!reconnected)
      return r.fulfill({
        status: 409,
        json: {
          code: "x_reauthentication_required",
          error:
            "Reconnect your X account to confirm ownership before linking this claim wallet.",
        },
      });
    binding = { xId: profile.xId, wallet };
    return r.fulfill({ json: { binding } });
  });
  await page.route("**/api/launchpad/link-x", (r) => {
    reconnectBody = r.request().postDataJSON();
    reconnected = true;
    // Simulated OAuth return: this test never contacts X or establishes a real identity.
    return r.fulfill({
      json: {
        url: new URL("/app/creator-fees?x=linked", r.request().url()).href,
      },
    });
  });
  await page.goto("/app/creator-fees");
  await page
    .getByRole("button", { name: "Select Wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /Reconnect test wallet/ }).click();
  await page.getByRole("button", { name: "Link wallet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reconnect X", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Reconnect your X account" })).toHaveText(
    "Reconnect your X account to confirm ownership before linking this claim wallet.",
  );
  await page.getByRole("button", { name: "Reconnect X", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Link wallet", exact: true }),
  ).toBeEnabled();
  expect(reconnectBody).toEqual({ tokenId: "", returnTo: "/app/creator-fees" });
  expect(bindCalls).toBe(1); // Reauthentication does not silently create a permanent binding.
  await page.getByRole("button", { name: "Link wallet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Link wallet", exact: true }),
  ).toHaveCount(0);
  expect(bindCalls).toBe(2);
  expect(new URL(page.url()).pathname).toBe("/app/creator-fees");
});
