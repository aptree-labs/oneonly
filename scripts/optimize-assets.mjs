import sharp from "sharp";
import { mkdir, copyFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const source = path.join(root, "assets/degen-character");
const out = path.join(root, "apps/web/public/scene");
await mkdir(out, { recursive: true });
const report = [];
const geometry = {};
for (const width of [960, 1600, 2560]) {
  for (const format of ["avif", "webp"]) {
    const file = `background-${width}.${format}`;
    await sharp(path.join(source, "background.jpg"))
      .resize(width)
      [format]({ quality: format === "avif" ? 65 : 82 })
      .toFile(path.join(out, file));
    report.push({ file, bytes: (await stat(path.join(out, file))).size });
  }
}
// Keep each pose pair on the same transparent canvas so swapping never shifts its anchor.
const pairs = [
  ["pressed", "pissing"],
  ["screen-inspect", "screen-with-solana"],
  ["rocket-revealed", "rocket-launched"],
  ["dj-calm", "dj-rocking"],
];
for (const pair of pairs) {
  const bounds = [];
  for (const name of pair) {
    const { data, info } = await sharp(path.join(source, `${name}.png`))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let left = info.width,
      top = info.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] > 8) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    bounds.push({ left, top, right, bottom });
  }
  const left = Math.max(0, Math.min(...bounds.map((b) => b.left)) - 2),
    top = Math.max(0, Math.min(...bounds.map((b) => b.top)) - 2);
  const right = Math.min(1299, Math.max(...bounds.map((b) => b.right)) + 2),
    bottom = Math.min(1299, Math.max(...bounds.map((b) => b.bottom)) + 2);
  for (const name of pair)
    for (const width of [320, 640]) {
      const file = `${name}-${width}.webp`;
      await sharp(path.join(source, `${name}.png`))
        .extract({
          left,
          top,
          width: right - left + 1,
          height: bottom - top + 1,
        })
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 85, alphaQuality: 90 })
        .toFile(path.join(out, file));
      report.push({ file, bytes: (await stat(path.join(out, file))).size });
      if (width === 640) {
        const { data, info } = await sharp(path.join(out, file))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const points = [];
        for (let y = 0; y < info.height; y += 6) {
          let min = info.width,
            max = -1;
          for (let x = 0; x < info.width; x++) {
            if (data[(y * info.width + x) * 4 + 3] > 16) {
              min = Math.min(min, x);
              max = x;
            }
          }
          if (max >= 0) {
            points.push([min, y], [max, y]);
          }
        }
        points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cross = (o, a, b) =>
          (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [],
          upper = [];
        for (const p of points) {
          while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0)
            lower.pop();
          lower.push(p);
        }
        for (const p of [...points].reverse()) {
          while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0)
            upper.pop();
          upper.push(p);
        }
        const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
        geometry[name] = {
          width: info.width,
          height: info.height,
          hitArea:
            "polygon(" +
            hull
              .map(
                ([x, y]) =>
                  `${((100 * x) / info.width).toFixed(2)}% ${((100 * y) / info.height).toFixed(2)}%`,
              )
              .join(",") +
            ")",
        };
      }
    }
}
const sounds = [
  ["Peeing sound Effect.mp3", "pee.mp3"],
  ["solana-[AudioTrimmer.com].mp3", "solana.mp3"],
  ["ROCKET LAUNCH SOUND EFFECT - FREE.mp3", "rocket.mp3"],
  ["Fart 💨 DJ Remix - sound effect.mp3", "dj.mp3"],
];
for (const [from, to] of sounds)
  await copyFile(
    path.join(root, "assets/sound-library", from),
    path.join(root, "apps/web/public/sounds", to),
  );
await writeFile(
  path.join(root, "apps/web/src/lib/scene-assets.json"),
  JSON.stringify(geometry, null, 2) + "\n",
);
await writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.table(
  report.map((r) => ({ file: r.file, kB: Math.round(r.bytes / 1024) })),
);
