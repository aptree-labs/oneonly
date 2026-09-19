import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
]) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await page.goto("http://localhost:3000");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(tmpdir(), `oneonly-${name}.png`) });
  await page.getByRole("link", { name: "Early Access", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("main")?.classList.contains("is-joining"),
  );
  await page.waitForTimeout(1100);
  await page.screenshot({
    path: path.join(tmpdir(), `oneonly-${name}-signup.png`),
  });
  console.log(
    name,
    await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      images: performance
        .getEntriesByType("resource")
        .filter((r) => r.name.includes("/scene/"))
        .map((r) => ({ file: r.name.split("/").pop(), bytes: r.transferSize })),
    })),
  );
  await page.close();
}
await browser.close();
