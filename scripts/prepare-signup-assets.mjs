import sharp from "sharp";
import { copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const source = "assets/brand/early-access-share.jpg";
const output = "apps/web/public/brand/early-access-share-v1";
await copyFile(source, `${output}.jpg`);
for (const width of [384, 768]) {
  await sharp(source)
    .rotate()
    .resize(width)
    .webp({ quality: 82 })
    .toFile(`${output}-${width}.webp`);
}
// Contain the full square artwork inside the landscape social card, without cropping it.
await sharp(source)
  .rotate()
  .resize(1200, 630, { fit: "contain", background: "#e6e5c7" })
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(`${output}-og.jpg`);
// Match the existing 5.2 second action, removing the recording's quiet lead-in.
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-ss",
  "2.1",
  "-i",
  "assets/sound-library/Peeing on Ground.m4a",
  "-t",
  "5.2",
  "-vn",
  "-map_metadata",
  "-1",
  "-ac",
  "1",
  "-ar",
  "44100",
  "-af",
  "afade=t=in:d=0.08,afade=t=out:st=4.8:d=0.4",
  "-codec:a",
  "libmp3lame",
  "-b:a",
  "64k",
  "apps/web/public/sounds/pee-v2.mp3",
]);
