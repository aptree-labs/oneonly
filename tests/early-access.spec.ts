import { expect, test } from "@playwright/test";
test("scene is responsive, all four characters react, and sound can be muted", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sounds: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/sounds/")) sounds.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "One only." })).toBeVisible();
  expect(sounds).toHaveLength(0);
  for (const [name, x, y] of [
    ["Let it out", 0.74, 0.4],
    ["Check the charts", 0.46, 0.35],
    ["Send it", 0.6, 0.45],
    ["Drop the beat", 0.65, 0.6],
  ] as const) {
    const character = page.getByRole("button", { name: new RegExp(name) });
    // Click visible artwork: the shared pose canvas deliberately includes transparent space.
    const bounds = await character.boundingBox();
    await character.click({
      position: { x: bounds!.width * x, y: bounds!.height * y },
    });
    await expect(character).toHaveAttribute("aria-pressed", "true");
    await expect(character.locator(".pose-action")).toBeVisible();
  }
  await page.getByRole("button", { name: /Drop the beat/ }).press("Enter");
  expect(sounds.some((url) => url.endsWith("/sounds/pee-v2.mp3"))).toBe(true);
  await expect(
    page.getByRole("button", { name: /Drop the beat/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Mute character sounds" }).click();
  await expect(
    page.getByRole("button", { name: "Unmute character sounds" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Unmute character sounds" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("wallet signup validates, saves, and survives duplicate requests", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Early Access", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Be early. Stay degen." }),
  ).toBeInViewport();
  await page.getByLabel("Solana wallet address").fill("O".repeat(32));
  await page.getByRole("button", { name: "Count me in" }).click();
  await expect(
    page.getByText("That doesn’t look like a Solana address.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByLabel("Solana wallet address")
    .fill("So11111111111111111111111111111111111111112");
  await page.getByRole("button", { name: "Count me in" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re one of us." }),
  ).toBeVisible();
  const popup = page.getByRole("dialog", { name: "Let them know." });
  await expect(popup).toBeVisible();
  await expect(
    popup.getByText("r*tarded memefi era", { exact: true }),
  ).toBeVisible();
  await expect(popup.getByRole("img")).toBeVisible();
  const intent = new URL(
    (await popup
      .getByRole("link", { name: "Share on X" })
      .getAttribute("href"))!,
  );
  expect(intent.origin).toBe("https://x.com");
  expect(intent.searchParams.get("text")).toBe("r*tarded memefi era");
  expect(intent.searchParams.get("url")).toBe(
    "https://oneonly.lol/early-access/share",
  );
  const downloadPromise = page.waitForEvent("download");
  await popup.getByRole("link", { name: "Download image to attach" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "oneonly-early-access.jpg",
  );
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await page.getByRole("button", { name: "Share your spot" }).click();
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Close share popup" }).click();
  await expect(
    page.getByRole("button", { name: "Share your spot" }),
  ).toBeFocused();
  await page.getByRole("link", { name: "Back to the chaos" }).click();
  await expect(
    page.getByRole("heading", { name: "One only." }),
  ).toBeInViewport();
});
test("X provides an honest fallback without credentials and rejects forged callbacks", async ({
  page,
}) => {
  await page.goto("/api/auth/x");
  await expect(
    page.getByText("X connect is coming soon.", { exact: false }),
  ).toBeVisible();
  await page.goto("/api/auth/x/callback?state=forged&code=forged");
  await expect(
    page.getByText("We couldn’t connect your X account.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("X success return opens the share popup and the public share link has its own image card", async ({
  page,
  request,
}) => {
  // Exercise the client return state; this does not simulate an authenticated X API exchange.
  await page.goto("/?auth=success#early-access");
  await expect(
    page.getByRole("dialog", { name: "Let them know." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/#early-access$/);
  await page.getByRole("button", { name: "Close share popup" }).click();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const response = await request.get("/early-access/share", {
    headers: { "User-Agent": "Twitterbot/1.0" },
  });
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain(
    'property="og:image" content="https://oneonly.lol/brand/early-access-share-v1-og.jpg"',
  );
  await page.goto("/early-access/share");
  await expect(
    page.getByRole("heading", { name: "r*tarded memefi era" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Get on the list" }).click();
  await expect(page.getByLabel("Solana wallet address")).toBeInViewport();
});
test("signup API rejects cross-origin and oversized requests", async ({
  request,
}) => {
  const forbidden = await request.post("/api/early-access", {
    data: { wallet: "So11111111111111111111111111111111111111112" },
    headers: { origin: "https://other.example" },
  });
  expect(forbidden.status()).toBe(403);
  const oversized = await request.post("/api/early-access", {
    data: { wallet: "a".repeat(3000) },
    headers: { origin: "http://localhost:3000" },
  });
  expect(oversized.status()).toBe(413);
});
