import sharp, { type Color } from "sharp";
import { describe, expect, it } from "vitest";
import { MediaValidationError } from "./errors";
import { detectFormat, processImage } from "./process";

const solid = (w: number, h: number, channels: 3 | 4 = 3, background: Color = { r: 200, g: 30, b: 30 }) =>
  sharp({ create: { width: w, height: h, channels, background } });

const jpeg = (w = 64, h = 48) => solid(w, h).jpeg().toBuffer();
const png = (w = 64, h = 48, alpha = false) => solid(w, h, alpha ? 4 : 3, alpha ? { r: 0, g: 200, b: 0, alpha: 0.4 } : undefined).png().toBuffer();
const webp = (w = 64, h = 48) => solid(w, h).webp().toBuffer();

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (x) => x);
  expect(e, "expected a rejection").toBeInstanceOf(MediaValidationError);
  return (e as MediaValidationError).code;
}

describe("processImage: accepted inputs", () => {
  it.each([
    ["jpeg", jpeg],
    ["png", png],
    ["webp", webp],
  ])("re-encodes %s as WebP with real output metadata", async (_n, make) => {
    const out = await processImage(await make());
    expect(out.mimeType).toBe("image/webp");
    expect(detectFormat(out.buffer)).toBe("webp");
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect([out.width, out.height]).toEqual([meta.width, meta.height]);
    expect(out.sizeBytes).toBe(out.buffer.length);
    expect([out.width, out.height]).toEqual([64, 48]);
  });

  it("downscales to at most 2048x2048 keeping the aspect ratio, and never enlarges", async () => {
    const big = await processImage(await jpeg(4000, 1000));
    expect([big.width, big.height]).toEqual([2048, 512]);
    const tall = await processImage(await jpeg(1000, 3000));
    expect([tall.width, tall.height]).toEqual([683, 2048]);
    const small = await processImage(await jpeg(100, 100));
    expect([small.width, small.height]).toEqual([100, 100]);
  });

  it("preserves transparency", async () => {
    const out = await processImage(await png(32, 32, true));
    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data[3]).toBeLessThan(255);
  });

  it("applies EXIF orientation and strips EXIF/GPS metadata", async () => {
    const withExif = await solid(80, 40)
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-owner" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "35/1 41/1 0/1" } })
      .toBuffer();
    const tagged = await sharp(withExif).withMetadata({ orientation: 6 }).toBuffer(); // keeps the EXIF above, adds orientation
    const before = await sharp(tagged).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();
    expect(tagged.includes(Buffer.from("secret-owner"))).toBe(true);
    const out = await processImage(tagged);
    expect([out.width, out.height]).toEqual([40, 80]); // rotated by orientation 6
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.buffer.includes(Buffer.from("secret-owner"))).toBe(false);
    expect(out.buffer.includes(Buffer.from("GPS"))).toBe(false);
  });
});

describe("processImage: rejected inputs", () => {
  it("rejects empty files and files over 5 MB (before any decoding)", async () => {
    expect(await code(processImage(Buffer.alloc(0)))).toBe("empty");
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]);
    expect(await code(processImage(huge))).toBe("too_large");
  });

  it.each([
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["plain text", Buffer.from("hello world, not an image")],
    ["PDF", Buffer.from("%PDF-1.7\n%....")],
    ["ZIP", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
  ])("rejects %s by content, whatever the name or type claims", async (_n, buf) => {
    expect(await code(processImage(buf))).toBe("unsupported_format");
  });

  it("rejects GIF and other formats that are not on the allow-list", async () => {
    const gif = await solid(10, 10).gif().toBuffer();
    expect(await code(processImage(gif))).toBe("unsupported_format");
    const tiff = await solid(10, 10).tiff().toBuffer();
    expect(await code(processImage(tiff))).toBe("unsupported_format");
  });

  it("rejects animated WebP", async () => {
    const frames = Buffer.concat([await solid(16, 16).raw().toBuffer(), await solid(16, 16, 3, { r: 0, g: 0, b: 255 }).raw().toBuffer()]);
    const animated = await sharp(frames, { raw: { width: 16, height: 16 * 2, channels: 3, pageHeight: 16 } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    expect(await code(processImage(animated))).toBe("animated");
  });

  it("rejects APNG (animated PNG)", async () => {
    const p = await png();
    const ihdrEnd = 8 + 12 + 13; // signature + IHDR chunk
    const actl = Buffer.alloc(12 + 8);
    actl.writeUInt32BE(8, 0);
    actl.write("acTL", 4, "latin1");
    actl.writeUInt32BE(2, 8); // frames
    const apng = Buffer.concat([p.subarray(0, ihdrEnd), actl, p.subarray(ihdrEnd)]);
    expect(await code(processImage(apng))).toBe("animated");
  });

  it("rejects polyglots: data appended after the image end marker", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
    expect(await code(processImage(Buffer.concat([await jpeg(), zip])))).toBe("corrupt");
    expect(await code(processImage(Buffer.concat([await png(), Buffer.from("<?php system($_GET['c']); ?>")])))).toBe("corrupt");
    expect(await code(processImage(Buffer.concat([await webp(), zip, zip])))).toBe("corrupt");
  });

  it("rejects truncated and corrupt images", async () => {
    const j = await jpeg(200, 200);
    expect(await code(processImage(j.subarray(0, j.length - 40)))).toBe("corrupt");
    const p = await png(200, 200);
    expect(await code(processImage(p.subarray(0, p.length - 20)))).toBe("corrupt");
    const w = await webp(200, 200);
    expect(await code(processImage(w.subarray(0, w.length - 10)))).toBe("corrupt");
    const damaged = Buffer.from(p);
    damaged.fill(0x13, 40, 80); // damage the compressed data, keep the container intact
    expect(await code(processImage(damaged))).toBe("corrupt");
  });

  it("rejects decompression bombs: a tiny file that decodes to more than 25 megapixels", async () => {
    const bomb = await solid(6000, 5000).png({ compressionLevel: 9 }).toBuffer(); // 30 MP
    expect(bomb.length).toBeLessThan(1024 * 1024); // small on disk ...
    expect(await code(processImage(bomb))).toBe("too_many_pixels"); // ... huge in memory
  });

  it("accepts images right at the pixel limit and rejects just above it", async () => {
    expect((await processImage(await solid(5000, 5000).png().toBuffer())).width).toBe(2048); // exactly 25 MP
    expect(await code(processImage(await solid(5001, 5000).png().toBuffer()))).toBe("too_many_pixels");
  });

  it("never leaks library error text", async () => {
    const e = await processImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9])).then(() => null, (x) => x as Error);
    expect(e).toBeInstanceOf(MediaValidationError);
    expect(e!.message).not.toMatch(/vips|sharp|libjpeg|Input/i);
  });
});
