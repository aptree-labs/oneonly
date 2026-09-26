// Base64 adds one third to the upload size. This stays below the API's
// 400 KB JSON limit, including the surrounding request fields.
export const MAX_TOKEN_IMAGE_BYTES = 280_000;

function encodedImageBytes(dataUrl: string): number {
  const match =
    /^data:image\/(?:webp|png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  if (!match) return Infinity;
  const data = match[1];
  return (
    (data.length * 3) / 4 -
    (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
  );
}

export async function prepareTokenImage(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10_000_000
  ) {
    throw new Error("Choose a PNG, JPEG, or WebP under 10 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That image could not be loaded.");
    const side = Math.min(bitmap.width, bitmap.height);
    for (const size of [512, 384, 256, 192, 128]) {
      canvas.width = size;
      canvas.height = size;
      context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      for (const quality of [0.82, 0.7, 0.55]) {
        const result = canvas.toDataURL("image/webp", quality);
        if (encodedImageBytes(result) <= MAX_TOKEN_IMAGE_BYTES) return result;
        // Browsers without WebP encoding return PNG and ignore quality.
        // Reduce dimensions instead, preserving the image's transparency.
        if (!result.startsWith("data:image/webp;")) break;
      }
    }
    throw new Error("That image could not be resized. Choose another image.");
  } finally {
    bitmap.close();
  }
}
