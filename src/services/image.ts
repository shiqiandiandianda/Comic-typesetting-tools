import type { Asset } from "../core/document";

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_EMBEDDED_LENGTH = 28 * 1024 * 1024;

function imageMime(bytes: Uint8Array): Asset["mimeType"] | null {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return null;
}

/** Read and normalize EXIF orientation locally. Nothing leaves the browser. */
export async function readImage(file: File): Promise<Asset> {
  if (file.size === 0) throw new Error("图片文件为空。");
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("图片超过 40 MB，请先缩小文件。");
  const mime = imageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mime) throw new Error("仅支持真实的 PNG、JPG 和 WebP 图片。");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("图片无法解码，文件可能已损坏或格式不受支持。");
  }
  const canvas = document.createElement("canvas");
  try {
    const { width, height } = bitmap;
    if (width * height > MAX_IMAGE_PIXELS || width > 32_767 || height > 32_767)
      throw new Error(
        "图片尺寸超过浏览器处理预算（4000 万像素），请先缩小图片。",
      );
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建图片工作画布。");
    context.drawImage(bitmap, 0, 0);
    // PNG preserves alpha and the exact orientation-corrected working pixels.
    const data = canvas.toDataURL("image/png");
    if (data === "data:,")
      throw new Error("图片超过浏览器画布限制，请缩小图片。");
    if (data.length > MAX_EMBEDDED_LENGTH)
      throw new Error(
        "方向校正后的图片超过项目嵌入预算（28 MB），请缩小图片后再载入。",
      );
    return {
      id: `asset_${crypto.randomUUID()}`,
      mimeType: "image/png",
      width,
      height,
      source: { type: "embedded", data },
    };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
