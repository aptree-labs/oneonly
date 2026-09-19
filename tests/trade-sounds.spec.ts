import { test, expect } from "@playwright/test";
test("trade sound preference persists and topbar fits small screens", async ({
  page,
}, info) => {
  await page.goto("/app/create");
  const mute = page.getByRole("button", {
    name: "Mute trade sounds",
    exact: true,
  });
  await expect(mute).toBeVisible();
  await mute.click();
  await expect(
    page.getByRole("button", { name: "Enable trade sounds", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable trade sounds", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enable trade sounds", exact: true })
    .click();
  await expect(mute).toBeVisible();
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/oneonly-sound-toggle-${info.project.name}.png`,
  });
});
