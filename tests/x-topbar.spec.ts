import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json"));
const { Keypair } = require("@solana/web3.js");
for (const linked of [false, true]) {
  test(`topbar X ${linked ? "verified identity" : "wallet-bound linking"}`, async ({
    page,
  }) => {
    const key = Keypair.generate();
    const address = key.publicKey.toBase58();
    await page.addInitScript(
      ({ address, bytes }) => {
        const account = {
          address,
          publicKey: new Uint8Array(bytes),
          chains: ["solana:mainnet"],
          features: ["solana:signTransaction"],
        };
        const wallet = {
          name: "X Test Wallet",
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
                throw new Error("No transactions in profile tests");
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
      { address, bytes: Array.from(key.publicKey.toBytes()) as number[] },
    );
    let request: unknown;
    await page.route("**/api/launchpad/**", (route) => {
      const path = new URL(route.request().url()).pathname.split(
        "/api/launchpad/",
      )[1];
      if (path === "profile")
        return route.fulfill({
          json: {
            wallet: address,
            profile: linked
              ? { username: "verified_trader", avatar: null }
              : null,
            available: true,
          },
        });
      if (path === "session")
        return route.fulfill({ json: { wallet: address } });
      if (path === "link-x") {
        request = route.request().postDataJSON();
        return route.fulfill({
          json: { url: "https://oneonly.lol/api/auth/x?link=mock-ticket" },
        });
      }
      return route.fulfill({ json: { tokens: [], total: 0 } });
    });
    await page.route(
      "https://oneonly.lol/api/auth/x?link=mock-ticket",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<p>Mock OAuth handoff</p>",
        }),
    );
    await page.goto("/app");
    await expect(
      page.locator(".wallet-adapter-button-trigger"),
    ).not.toContainText("Select Wallet");
    if (linked) {
      const profile = page.getByRole("link", {
        name: "X profile @verified_trader",
      });
      await expect(profile).toHaveAttribute(
        "href",
        "https://x.com/verified_trader",
      );
      await expect(
        page.getByRole("button", { name: "Connect X account" }),
      ).toHaveCount(0);
    } else {
      await page.getByRole("button", { name: "Connect X account" }).click();
      await expect(page).toHaveURL(
        "https://oneonly.lol/api/auth/x?link=mock-ticket",
      );
      expect(request).toEqual({ tokenId: "" });
    }
  });
}
