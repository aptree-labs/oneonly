import { chromium } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";
const browser = await chromium.launch({ headless: true });
for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width, height } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const route of ["app", "app/create", "app/portfolio"]) {
    await page.goto(
      `${process.env.VISUAL_APP_URL || "http://localhost:3000"}/${route}`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2000);
    const file = path.join(
      tmpdir(),
      `oneonly-${name}-${route.replaceAll("/", "-")}.png`,
    );
    await page.screenshot({ path: file, fullPage: true });
    console.log({
      route,
      name,
      file,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      errors,
    });
  }
  await page.close();
}
await browser.close();
