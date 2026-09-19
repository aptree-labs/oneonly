import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "@playwright/test";

const root = process.cwd();
const web = path.join(root, "apps/web");
const brand = path.join(web, "public/brand");
await mkdir(brand, { recursive: true });
const logo = await readFile(path.join(root, "assets/brand/oneonly-logo.jpg"));
for (const size of [64, 128, 256]) {
  await sharp(logo)
    .resize(size, size)
    .webp({ quality: 90 })
    .toFile(path.join(brand, `logo-${size}.webp`));
}
await sharp(logo)
  .resize(64, 64)
  .png()
  .toFile(path.join(web, "src/app/icon.png"));
for (const size of [192, 512]) {
  await sharp(logo)
    .resize(size, size)
    .png()
    .toFile(path.join(brand, `icon-${size}.png`));
}
await sharp(logo)
  .resize(180, 180)
  .flatten({ background: "#e8ed98" })
  .png()
  .toFile(path.join(web, "src/app/apple-icon.png"));
// PNG-backed ICO with native 16, 32 and 48px frames for small browser tabs.
const frames = await Promise.all(
  [16, 32, 48].map((size) =>
    sharp(logo).resize(size, size).ensureAlpha().png().toBuffer(),
  ),
);
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
for (let i = 0; i < frames.length; i++) {
  const position = 6 + i * 16;
  header[position] = [16, 32, 48][i];
  header[position + 1] = [16, 32, 48][i];
  header.writeUInt16LE(1, position + 4);
  header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(frames[i].length, position + 8);
  header.writeUInt32LE(offset, position + 12);
  offset += frames[i].length;
}
await writeFile(
  path.join(web, "src/app/favicon.ico"),
  Buffer.concat([header, ...frames]),
);
const data = async (relative, mime) =>
  `data:${mime};base64,${(await readFile(path.join(web, relative))).toString("base64")}`;
const background = await data(
  "public/scene/background-1600.webp",
  "image/webp",
);
const marker = await data(
  "node_modules/@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2",
  "font/woff2",
);
const body = await data(
  "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2",
  "font/woff2",
);
const rocket = await data(
  "public/scene/rocket-launched-640.webp",
  "image/webp",
);
const dj = await data("public/scene/dj-rocking-640.webp", "image/webp");
const local = await data("public/scene/pressed-640.webp", "image/webp");
const chart = await data("public/scene/screen-inspect-640.webp", "image/webp");
const html = `<!doctype html><html><head><style>
@font-face{font-family:Marker;src:url('${marker}')}@font-face{font-family:Body;src:url('${body}');font-weight:700}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;color:#272c26;font-family:Body;background:#adceca}
.background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.wash{position:absolute;inset:0;background:linear-gradient(90deg,#b6d1c5b8 0%,#b6d1c599 34%,transparent 62%)}
.brand{position:absolute;left:49px;top:36px;display:flex;align-items:center;gap:13px}.brand .logo{width:58px;height:58px;border-radius:12px;border:2px solid #272c26}.wordmark{font:29px/.8 Marker;transform:rotate(-5deg);letter-spacing:-1px}.wordmark span{display:block;margin-left:12px}
.tag{position:absolute;right:48px;top:42px;border:2px solid #272c26;background:#e8ed98;border-radius:99px;padding:12px 19px;font-size:13px;letter-spacing:.5px;box-shadow:2px 3px #272c26}
.copy{position:absolute;left:70px;top:140px;transform:rotate(-3deg)}h1{font:88px/.97 Marker;letter-spacing:-3px;margin:0}h1 span{color:#e8ed98;-webkit-text-stroke:2px #272c26;paint-order:stroke fill;text-shadow:3px 4px #272c26}p{font-size:17px;line-height:1.6;letter-spacing:-.2px;margin:24px 0 0;transform:rotate(3deg)}
.rocket{position:absolute;width:380px;right:240px;bottom:67px}.dj{position:absolute;width:338px;right:0;bottom:-25px}.local{position:absolute;width:133px;left:505px;bottom:23px}.chart{position:absolute;width:210px;left:22px;bottom:12px}
.bottom{position:absolute;bottom:36px;left:340px;font-size:12px;letter-spacing:2px}.domain{position:absolute;right:46px;bottom:30px;background:#e8ed98;border:2px solid #272c26;box-shadow:3px 3px #272c26;border-radius:8px 12px 7px 9px;transform:rotate(-3deg);padding:11px 18px;font:20px Marker}
</style></head><body><img class="background" src="${background}"/><div class="wash"></div><div class="brand"><img class="logo" src="data:image/jpeg;base64,${logo.toString("base64")}"/><div class="wordmark">one<span>only</span></div></div><div class="tag">EARLY ACCESS IS OPEN ↗</div><div class="copy"><h1><span>One only.</span></h1></div><img class="rocket" src="${rocket}"/><img class="local" src="${local}"/><img class="dj" src="${dj}"/><img class="chart" src="${chart}"/><div class="domain">oneonly.lol</div></body></html>`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  const screenshot = await page.screenshot({ type: "png" });
  await sharp(screenshot)
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(path.join(brand, "oneonly-social-v3.jpg"));
  await page.evaluate(() => {
    document.querySelector(".tag").textContent = "LAUNCH. TRADE. REPEAT. ↗";
    document.querySelector(".domain").textContent = "app.oneonly.lol";
  });
  await sharp(await page.screenshot({ type: "png" }))
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(path.join(brand, "oneonly-app-social-v2.jpg"));
} finally {
  await browser.close();
}
console.log(
  "Generated optimized official logo, favicon, Apple icon, 192/512px app icons, and 1200×630 social image.",
);
