import { afterEach, expect, test, vi } from "vitest";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { purchaseShareImage } from "./purchase-share-image";
const web = resolve("apps/web");
afterEach(() => vi.restoreAllMocks());
test.each(["buy", "sell"] as const)(
  "renders %s artwork for download and a wide X card",
  async (side) => {
    vi.spyOn(process, "cwd").mockReturnValue(web);
    for (const card of [false, true]) {
      const response = await purchaseShareImage(
        card ? "ABCDEFGHIJ" : "GIDDY",
        card,
        side,
      );
      const image = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(image).metadata();
      expect(meta.width).toBe(1200);
      expect(meta.height).toBe(card ? 630 : 1018);
      expect(response.headers.get("Content-Type")).toContain("image/png");
      await writeFile(
        `/tmp/oneonly-${side}-share-${card ? "card" : "art"}.png`,
        image,
      );
    }
  },
);

test.each([false, true])(
  "renders a personal sale P&L card (wide=%s)",
  async (card) => {
    vi.spyOn(process, "cwd").mockReturnValue(web);
    const response = await purchaseShareImage("GIDDY", card, "sell", {
      status: "ready",
      wallet: "9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR",
      signature: "fixture",
      quote: "SOL",
      quantity: "1837065.8983",
      proceeds: "0.075",
      costBasis: "0.05",
      pnl: "0.025",
      percent: 50,
    });
    const image = Buffer.from(await response.arrayBuffer());
    expect((await sharp(image).metadata()).height).toBe(card ? 630 : 1018);
    await writeFile(
      `/tmp/oneonly-sale-pnl-${card ? "wide" : "full"}.png`,
      image,
    );
  },
);
