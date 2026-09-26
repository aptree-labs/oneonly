import { afterEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { MAX_TOKEN_IMAGE_BYTES, prepareTokenImage } from "./token-image";
import { jsonBody } from "./launchpad/auth";

afterEach(() => vi.unstubAllGlobals());

function canvasWith(encode: (size: number, quality: number) => string) {
  const close = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toDataURL: vi.fn((_type: string, quality: number) =>
      encode(canvas.width, quality),
    ),
  };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 900, height: 600, close })),
  );
  vi.stubGlobal("document", { createElement: () => canvas });
  return { canvas, close, drawImage };
}
function dataUrl(size: number, type = "webp") {
  return `data:image/${type};base64,${Buffer.alloc(size).toString("base64")}`;
}
const file = () => new File(["image"], "token.png", { type: "image/png" });
function requestFor(dataUrl: string) {
  return new Request("http://localhost/api/launchpad/image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: dataUrl.split(",")[1] }),
  });
}

it("keeps a normal image at 512px and fits the real API body reader", async () => {
  const { canvas, drawImage, close } = canvasWith(() =>
    dataUrl(MAX_TOKEN_IMAGE_BYTES),
  );
  const image = await prepareTokenImage(file());
  const body = await jsonBody(requestFor(image));
  expect(Buffer.from(body.data as string, "base64")).toHaveLength(
    MAX_TOKEN_IMAGE_BYTES,
  );
  expect(drawImage).toHaveBeenCalledWith(
    expect.anything(),
    150,
    0,
    600,
    600,
    0,
    0,
    512,
    512,
  );
  expect(canvas.toDataURL).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledOnce();
});

it("lowers WebP quality before reducing resolution", async () => {
  const { canvas } = canvasWith((_size, quality) =>
    dataUrl(quality > 0.7 ? 300_000 : 200_000),
  );
  await prepareTokenImage(file());
  expect(canvas.width).toBe(512);
  expect(canvas.toDataURL.mock.calls).toEqual([
    ["image/webp", 0.82],
    ["image/webp", 0.7],
  ]);
});

it("reproduces the large PNG fallback error and resizes it without dropping alpha", async () => {
  const source = randomBytes(512 * 512 * 4);
  const images = new Map<number, string>();
  for (const size of [512, 384, 256]) {
    const png = await sharp(source, {
      raw: { width: 512, height: 512, channels: 4 },
    })
      .resize(size, size)
      .png()
      .toBuffer();
    images.set(size, `data:image/png;base64,${png.toString("base64")}`);
  }
  await expect(jsonBody(requestFor(images.get(512)!))).rejects.toThrow(
    "Request is too large.",
  );
  const { canvas, close } = canvasWith((size) => images.get(size)!);
  const image = await prepareTokenImage(file());
  const body = await jsonBody(requestFor(image));
  const result = Buffer.from(body.data as string, "base64");
  expect(result.length).toBeLessThanOrEqual(MAX_TOKEN_IMAGE_BYTES);
  expect((await sharp(result).metadata()).hasAlpha).toBe(true);
  expect(canvas.width).toBeLessThan(512);
  expect(
    canvas.toDataURL.mock.calls.every(([, quality]) => quality === 0.82),
  ).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});

it("reduces dimensions if quality changes cannot meet the upload limit", async () => {
  const { canvas } = canvasWith((size) =>
    dataUrl(size > 256 ? 290_000 : 150_000),
  );
  await prepareTokenImage(file());
  expect(canvas.width).toBe(256);
});

it("fails before upload and releases the bitmap if encoding fails", async () => {
  const { close } = canvasWith(() => "data:,");
  await expect(prepareTokenImage(file())).rejects.toThrow(
    "Choose another image",
  );
  expect(close).toHaveBeenCalledOnce();
});

it("retains file type and size limits before decoding", async () => {
  canvasWith(() => dataUrl(100));
  await expect(
    prepareTokenImage(new File(["svg"], "icon.svg", { type: "image/svg+xml" })),
  ).rejects.toThrow("under 10 MB");
  await expect(
    prepareTokenImage(
      new File([new Uint8Array(10_000_001)], "large.png", {
        type: "image/png",
      }),
    ),
  ).rejects.toThrow("under 10 MB");
  expect(createImageBitmap).not.toHaveBeenCalled();
});
