import sharp from "sharp";
import { MAX_INPUT_PIXELS, MAX_OUTPUT_DIMENSION, MAX_UPLOAD_BYTES, OUTPUT_MIME } from "./limits";
import { MediaValidationError } from "./errors";

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: typeof OUTPUT_MIME;
}

type Format = "jpeg" | "png" | "webp";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Format from the real bytes. The file name and the browser-supplied MIME type are never consulted. */
export function detectFormat(b: Buffer): Format | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG)) return "png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Structural check: the container must be well formed and end exactly where it says it does, so bytes
 * appended after the image (a classic polyglot/payload smuggling technique) are rejected. Also detects
 * animation (APNG `acTL`, animated WebP `ANIM`/`ANMF`). Best effort by design: the pixels are re-encoded
 * afterwards anyway, so nothing of the original container survives in the stored object.
 */
function checkStructure(format: Format, b: Buffer): void {
  if (format === "jpeg") {
    if (b.length < 4 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) throw new MediaValidationError("corrupt");
    return;
  }
  if (format === "png") {
    let off = 8;
    let first = true;
    while (off + 12 <= b.length) {
      const len = b.readUInt32BE(off);
      const type = b.toString("latin1", off + 4, off + 8);
      if (first && type !== "IHDR") throw new MediaValidationError("corrupt");
      first = false;
      if (type === "acTL") throw new MediaValidationError("animated");
      const next = off + 12 + len;
      if (next > b.length) throw new MediaValidationError("corrupt");
      if (type === "IEND") {
        if (next !== b.length) throw new MediaValidationError("corrupt"); // trailing data after IEND
        return;
      }
      off = next;
    }
    throw new MediaValidationError("corrupt"); // no IEND
  }
  // webp (RIFF)
  const riffSize = b.readUInt32LE(4);
  if (riffSize + 8 !== b.length && riffSize + 9 !== b.length) throw new MediaValidationError("corrupt");
  let off = 12;
  while (off + 8 <= b.length) {
    const tag = b.toString("latin1", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (tag === "ANIM" || tag === "ANMF") throw new MediaValidationError("animated");
    if (tag === "VP8X" && b.length > off + 8 && (b[off + 8]! & 0x02) !== 0) throw new MediaValidationError("animated");
    off += 8 + size + (size % 2);
  }
  if (off !== b.length && off !== riffSize + 8) throw new MediaValidationError("corrupt");
}

/**
 * The single image pipeline for every upload (product images, store logo): validate -> decode with hard
 * limits -> orient -> downscale to <= 2048 px -> re-encode as WebP. Re-encoding strips EXIF/GPS/ICC and any
 * embedded data; transparency is preserved (WebP supports alpha). The output type is always image/webp and
 * its dimensions come from the encoder, never from the client.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new MediaValidationError("empty");
  if (input.length > MAX_UPLOAD_BYTES) throw new MediaValidationError("too_large");
  const format = detectFormat(input);
  if (!format) throw new MediaValidationError("unsupported_format");
  checkStructure(format, input);

  const opts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const, sequentialRead: true };
  try {
    const meta = await sharp(input, { ...opts, animated: true }).metadata();
    if ((meta.pages ?? 1) > 1) throw new MediaValidationError("animated");
    if (!meta.width || !meta.height) throw new MediaValidationError("corrupt");
    if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new MediaValidationError("too_many_pixels");

    const { data, info } = await sharp(input, { ...opts, animated: false })
      .rotate()
      .resize({ width: MAX_OUTPUT_DIMENSION, height: MAX_OUTPUT_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 100, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (data.length > MAX_UPLOAD_BYTES) throw new MediaValidationError("output_too_large");
    return { buffer: data, width: info.width, height: info.height, sizeBytes: data.length, mimeType: OUTPUT_MIME };
  } catch (e) {
    if (e instanceof MediaValidationError) throw e;
    // Library errors (corrupt data, pixel limit exceeded by the decoder, ...) are mapped, never leaked.
    throw new MediaValidationError(/pixel limit/i.test(String((e as Error)?.message)) ? "too_many_pixels" : "corrupt");
  }
}
