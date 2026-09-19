import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json"));
const {
  Keypair,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
} = require("@solana/web3.js");

for (const mode of [
  "immediate",
  "poll",
  "fee",
  "sell",
  "reject",
  "server-reject",
] as const) {
  const changed = mode === "fee";
  test(`wallet signing ${mode}: direct approval confirms with bounded wallet fees`, async ({
    page,
  }) => {
    const payer = Keypair.generate(),
      address = payer.publicKey.toBase58();
    const transaction = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    );
    const wire = transaction
      .serialize({ requireAllSignatures: false })
      .toString("base64");
    if (changed)
      transaction.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 2000,
      });
    transaction.sign(payer);
    const returned = Array.from(transaction.serialize()) as number[];
    await page.addInitScript(
      ({ address, publicKey, returned, reject }) => {
        const account = {
          address,
          publicKey: new Uint8Array(publicKey),
          chains: ["solana:mainnet"],
          features: ["solana:signTransaction"],
        };
        const wallet = {
          name: "Signature Test Wallet",
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
                if (reject) throw new Error("User rejected the request");
                return [{ signedTransaction: new Uint8Array(returned) }];
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
      {
        address,
        reject: mode === "reject",
        publicKey: Array.from(payer.publicKey.toBytes()) as number[],
        returned,
      },
    );
    await page.route("**/app/share/*/image*", (route) =>
      route.fulfill({
        contentType: "image/jpeg",
        body: readFileSync(
          `apps/web/public/brand/${new URL(route.request().url()).searchParams.get("side") === "sell" ? "sell" : "buy"}-share-v1.jpg`,
        ),
      }),
    );
    let submitted = "";
    let feeReviews = 0;
    let polls = 0;
    let tradeRequest: Record<string, unknown> = {};
    await page.route("**/api/launchpad/**", (route) => {
      const path = new URL(route.request().url()).pathname.split(
        "/api/launchpad/",
      )[1];
      if (path === "comment")
        return route.fulfill({
          json: {
            comment: {
              id: "posted",
              wallet: address,
              body: route.request().postDataJSON().body,
              purchaseSignature: "fixture-receipt",
              createdAt: new Date().toISOString(),
              profile: null,
            },
          },
        });
      if (path === "session")
        return route.fulfill({ json: { wallet: address } });
      if (path.startsWith("token/"))
        return route.fulfill({
          json: {
            id: "signature-fixture",
            name: "Signature fixture",
            ticker: "TEST",
            quote: "SOL",
            mint: address,
            creator: address,
            imageId: "fixture",
            status: "active",
            trades: [],
            snapshot: {
              graduated: false,
              readyToMigrate: false,
              progress: 1,
              priceQuote: "0.01",
              marketCapQuote: "100",
              quoteReserve: "1",
              creatorQuoteFee: "0",
            },
          },
        });
      if (path.startsWith("trade-assets/"))
        return route.fulfill({
          json: {
            wallet: address,
            tokenBalance: "100.123456",
            assets: [
              { symbol: "SOL", name: "Solana", decimals: 9, balance: "1.5" },
              { symbol: "USDC", name: "USD Coin", decimals: 6, balance: "200" },
              {
                symbol: "SPYX",
                name: "SP500 xStock",
                decimals: 8,
                balance: "0.0125",
              },
            ],
          },
        });
      if (path === "trade") {
        tradeRequest = route.request().postDataJSON();
        return route.fulfill({
          json: {
            id: "review-fixture",
            tokenId: "signature-fixture",
            status: "prepared",
            kind: "trade",
            transaction: wire,
            details: {
              network: "mainnet-beta",
              side: mode === "sell" ? "sell" : "buy",
              ticker: "TEST",
              input: "0.00001 SOL",
              priorityFee: "0.0000014 SOL",
            },
          },
        });
      }
      if (path === "review-wallet-fee") {
        feeReviews++;
        const unsigned = Transaction.from(Buffer.from(returned));
        unsigned.signatures.forEach(
          (entry: { signature: Buffer | null }) => (entry.signature = null),
        );
        return route.fulfill({
          json: {
            id: "review-fixture",
            tokenId: "signature-fixture",
            kind: "trade",
            status: "prepared",
            transaction: unsigned
              .serialize({ requireAllSignatures: false })
              .toString("base64"),
            details: {
              network: "mainnet-beta",
              side: "buy",
              ticker: "TEST",
              priorityFee: "0.0000028 SOL",
            },
          },
        });
      }
      if (path === "intent/review-fixture") {
        polls++;
        return route.fulfill({
          json: {
            id: "review-fixture",
            tokenId: "signature-fixture",
            kind: "trade",
            status: polls > 1 ? "confirmed" : "submitted",
            details: { network: "mainnet-beta", side: "buy", ticker: "TEST" },
          },
        });
      }
      if (path === "submit") {
        submitted = route.request().postDataJSON().transaction;
        if (mode === "server-reject")
          return route.fulfill({
            status: 409,
            json: {
              error:
                "The wallet changed more than the network fee (instructions). Nothing was sent. Request a fresh quote.",
            },
          });
        return route.fulfill({
          json: {
            id: "review-fixture",
            tokenId: "signature-fixture",
            status: mode === "poll" ? "submitted" : "confirmed",
          },
        });
      }
      if (path.startsWith("candles/"))
        return route.fulfill({ json: { candles: [], hasMore: false } });
      if (path.startsWith("sale-share/"))
        return route.fulfill({
          json: {
            status: "ready",
            wallet: address,
            signature: "fixture",
            quote: "SOL",
            quantity: "1",
            proceeds: "0.075",
            costBasis: "0.05",
            pnl: "0.025",
            percent: 50,
          },
        });
      if (route.request().url().includes("/comments/"))
        return route.fulfill({ json: { comments: [], next: null } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/app/token/signature-fixture");
    await expect(page.locator(".wallet-adapter-button-trigger")).toContainText(
      address.slice(0, 4),
    );
    await expect(
      page.getByRole("button", { name: "Max", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Max", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "You pay", exact: true }),
    ).toHaveValue("1.49");
    await page.getByRole("combobox", { name: "Pay with", exact: true }).click();
    await page.getByRole("option", { name: /^USDC/ }).click();
    await expect(
      page.getByRole("textbox", { name: "You pay", exact: true }),
    ).toHaveValue("");
    await page.getByRole("button", { name: "50%", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "You pay", exact: true }),
    ).toHaveValue("100");
    await page
      .getByRole("button", { name: "Reverse trade direction", exact: true })
      .click();
    await page.getByRole("button", { name: "Max", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "You sell", exact: true }),
    ).toHaveValue("100.123456");
    await page.getByRole("combobox", { name: "Receive", exact: true }).click();
    await page.getByRole("option", { name: /^SPYX/ }).click();
    await page
      .getByRole("button", { name: "Reverse trade direction", exact: true })
      .click();
    await page.getByRole("button", { name: "25%", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "You pay", exact: true }),
    ).toHaveValue("0.003125");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator(".lp-swap-panel").screenshot({
      path: `/tmp/oneonly-swap-${test.info().project.name}.png`,
    });
    if (mode === "sell") {
      await page
        .getByRole("button", { name: "Reverse trade direction", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "You sell", exact: true })
        .fill("1");
    }
    await page
      .getByRole("button", {
        name: mode === "sell" ? "Sell TEST" : "Buy TEST",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Check it. Then send it." }),
    ).toHaveCount(0);
    await expect
      .poll(() => tradeRequest)
      .toMatchObject({
        settlement: "SPYX",
        amount: mode === "sell" ? "1" : "0.003125",
        side: mode === "sell" ? "sell" : "buy",
      });
    expect(feeReviews).toBe(0);
    if (mode === "reject" || mode === "server-reject") {
      await expect(
        page.getByRole("textbox", { name: "You pay", exact: true }),
      ).toHaveValue("0.003125");
      await expect(page.locator(".lp-transaction-toast")).toContainText(
        mode === "reject" ? "rejected" : "Nothing was sent",
      );
      await expect(
        page.getByRole("button", { name: "Buy TEST", exact: true }),
      ).toBeEnabled();
      if (mode === "reject") expect(submitted).toBe("");
      expect(polls).toBe(0);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("oneonly-intent-mainnet-beta"),
        ),
      ).toBeNull();
      await expect(
        page.getByRole("button", { name: "Retry approval", exact: true }),
      ).toHaveCount(0);
      return;
    }
    {
      await expect
        .poll(() => submitted)
        .toBe(Buffer.from(returned).toString("base64"));
    }
    if (mode === "poll")
      await expect(page.locator(".lp-transaction-toast")).toContainText(
        "Confirming trade",
      );
    await expect(page.locator(".lp-success-toast")).toContainText(
      mode === "sell" ? "Sale confirmed" : "Purchase confirmed",
      { timeout: 12_000 },
    );
    await expect(
      page.getByRole("button", { name: "Approve in wallet", exact: true }),
    ).toHaveCount(0);
    {
      const share = page.getByRole("dialog", {
        name: mode === "sell" ? "Sold $TEST." : "You’re in, $TEST.",
      });
      await expect(share).toBeVisible();
      await expect(
        share.getByRole("img", {
          name:
            mode === "sell" ? "One Only sell artwork" : "$TEST in the puddle",
          exact: true,
        }),
      ).toBeVisible();
      const intent = new URL(
        (await share
          .getByRole("link", { name: "Share on X" })
          .getAttribute("href")) as string,
      );
      expect(intent.hostname).toBe("x.com");
      expect(intent.searchParams.get("text")).toBe(
        mode === "sell"
          ? "Just sold $TEST on One Only."
          : "Just bought $TEST on One Only.",
      );
      expect(intent.searchParams.get("url")).toBe(
        `https://app.oneonly.lol/app/share/signature-fixture${mode === "sell" ? "?side=sell&sale=review-fixture" : ""}`,
      );
      await expect(
        share.getByRole("link", { name: "Save image" }),
      ).toHaveAttribute("download", "");
      await expect(
        share.getByRole("link", { name: "Save image" }),
      ).toHaveAttribute(
        "href",
        new RegExp(`side=${mode === "sell" ? "sell" : "buy"}`),
      );
      expect(
        await share.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await share.screenshot({
        path: `/tmp/oneonly-${mode === "sell" ? "sell" : "buy"}-share-${test.info().project.name}.png`,
      });
      await page.keyboard.press("Escape");
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", {
        name: mode === "sell" ? "You sell" : "You pay",
        exact: true,
      }),
    ).toHaveValue("");
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("oneonly-intent-mainnet-beta"),
      ),
    ).toBeNull();
    if (mode === "immediate") {
      const composer = page.getByRole("textbox", { name: "Your comment" });
      await composer.fill("Successful trade, first take.");
      await composer.press("Control+Enter");
      await expect(page.locator(".lp-comment-list")).toContainText(
        "Successful trade, first take.",
      );
      await expect(composer).toHaveValue("");
      await page.locator(".lp-comments").screenshot({
        path: `/tmp/oneonly-composer-${test.info().project.name}.png`,
      });
    }
  });
}
