import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "../../lib/rate-limit.js";
import { setMediaStorageForTests } from "../../lib/storage/index.js";
import { variantKey, variantKeysOf } from "@store-builder/shared/lib/storage/variants";
import { twoTenants, validProduct } from "../../test/catalog-helpers.js";
import { prisma, resetDb } from "../../test/db-helpers.js";
import { MemoryMediaStorage } from "../../test/memory-storage.js";
import { createProduct } from "../products/service.js";
import { getDraftPreview } from "../storefront/service.js";
import { runMediaCleanup } from "./cleanup.js";
import { attachProductImage, deleteMedia, uploadMedia } from "./service.js";
import { backfillVariants } from "./backfill.js";

/**
 * Responsive images on real PostgreSQL: each upload also stores smaller copies (-w320/-w640/-w1024) and says so on its row; the copies are
 * removed with the image, found as orphans when their image is gone, and never block an upload; the published data tells pages when copies exist.
 */
beforeEach(resetDb);
afterEach(() => setMediaStorageForTests(undefined));
afterAll(() => prisma.$disconnect());

const picture = (w: number, h = Math.round(w * 0.75)) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).jpeg().toBuffer();
const quiet = () => undefined;
const setup = () => ({ storage: new MemoryMediaStorage(), limiter: new MemoryRateLimiter(), log: quiet });
async function fixture() {
  const { a, a1 } = await twoTenants();
  const deps = setup();
  setMediaStorageForTests(deps.storage);
  return { a, a1, deps };
}
const widthOf = async (buf: Buffer) => (await sharp(buf).metadata()).width;

describe("upload", () => {
  it("stores the image and its three smaller copies, in WebP at the promised widths, and marks the row", async () => {
    const f = await fixture();
    const m = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    expect(f.deps.storage.objects.size).toBe(4);
    expect(await Promise.all(variantKeysOf(m.key).map(async (k) => widthOf(f.deps.storage.objects.get(k)!.body)))).toEqual([320, 640, 1024]);
    for (const k of variantKeysOf(m.key)) expect(f.deps.storage.objects.get(k)!.contentType).toBe("image/webp");
    expect(await widthOf(f.deps.storage.objects.get(m.key)!.body)).toBe(1600);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m.id } })).variantsReady).toBe(true);
  });

  it("makes only the copies smaller than the picture, and none for a small one", async () => {
    const f = await fixture();
    const mid = await uploadMedia(f.a.id, f.a1, await picture(800), f.deps);
    expect([...f.deps.storage.objects.keys()].filter((k) => k !== mid.key).sort()).toEqual([variantKey(mid.key, 320), variantKey(mid.key, 640)]);
    const small = await uploadMedia(f.a.id, f.a1, await picture(300), f.deps);
    expect(f.deps.storage.objects.has(variantKey(small.key, 320))).toBe(false);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: small.id } })).variantsReady).toBe(false);
  });

  it("a failure storing a copy never fails the upload: the image works at full size, no stray copy stays, the row says no copies", async () => {
    const f = await fixture();
    let n = 0;
    const put = f.deps.storage.put.bind(f.deps.storage);
    f.deps.storage.put = async (key, body, o) => {
      if (++n === 3) throw new Error("storage hiccup"); // the main object (1) and the first copy (2) are stored, the second copy fails
      return put(key, body, o);
    };
    const m = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    expect([...f.deps.storage.objects.keys()]).toEqual([m.key]);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m.id } })).variantsReady).toBe(false);
  });
});

describe("removal", () => {
  it("deleting an image removes its copies too; a failed delete keeps everything for a retry", async () => {
    const f = await fixture();
    const m = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    f.deps.storage.failDelete = new Error("down");
    expect(await deleteMedia(f.a.id, f.a1, m.id, f.deps)).toBe("pending_delete");
    expect(f.deps.storage.objects.size).toBe(4); // nothing half-removed from the database's point of view: the row is DELETING and retried
    f.deps.storage.failDelete = null;
    await runMediaCleanup({ storage: f.deps.storage, graceMs: 0, now: () => new Date(Date.now() + 1000), log: quiet });
    expect(f.deps.storage.objects.size).toBe(0);
    expect(await prisma.media.count()).toBe(0);
  });

  it("the cleanup job removes copies whose image is gone, and leaves the copies of an existing image alone", async () => {
    const f = await fixture();
    const product = (await createProduct(f.a.id, f.a1, validProduct())).id;
    const kept = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    await attachProductImage(f.a.id, f.a1, product, kept.id, f.deps); // in use, so the unreferenced-image step leaves it alone too
    const gone = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    await prisma.media.delete({ where: { id: gone.id } }); // the row vanished (e.g. its store was deleted): the objects are orphans
    const report = await runMediaCleanup({ storage: f.deps.storage, graceMs: 0, now: () => new Date(Date.now() + 1000), log: quiet });
    expect(report.orphanObjectsRemoved).toBe(4);
    expect([...f.deps.storage.objects.keys()].sort()).toEqual([kept.key, ...variantKeysOf(kept.key)].sort());
  });

  it("an unused image is reclaimed with its copies, a used one keeps them", async () => {
    const f = await fixture();
    const product = (await createProduct(f.a.id, f.a1, validProduct())).id;
    const used = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    await attachProductImage(f.a.id, f.a1, product, used.id, f.deps);
    const unused = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    const report = await runMediaCleanup({ storage: f.deps.storage, graceMs: 0, now: () => new Date(Date.now() + 1000), log: quiet });
    expect(report.unreferencedReadyReclaimed).toBe(1);
    expect(f.deps.storage.objects.has(unused.key)).toBe(false);
    for (const k of variantKeysOf(unused.key)) expect(f.deps.storage.objects.has(k)).toBe(false);
    for (const k of [used.key, ...variantKeysOf(used.key)]) expect(f.deps.storage.objects.has(k)).toBe(true);
  });
});

describe("published data and the backfill", () => {
  it("a product image with copies says so in the storefront data, and one without does not", async () => {
    const f = await fixture();
    const p1 = (await createProduct(f.a.id, f.a1, validProduct({ name: "با نسخه" }))).id;
    const p2 = (await createProduct(f.a.id, f.a1, validProduct({ name: "بی‌نسخه" }))).id;
    await attachProductImage(f.a.id, f.a1, p1, (await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps)).id, f.deps);
    const old = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    await prisma.media.update({ where: { id: old.id }, data: { variantsReady: false } }); // an image from before copies existed
    await attachProductImage(f.a.id, f.a1, p2, old.id, f.deps);
    for (const id of [p1, p2]) await prisma.product.update({ where: { id }, data: { status: "ACTIVE" } });
    const data = (await getDraftPreview(f.a.id, f.a1)).data;
    const by = (name: string) => data.products.find((p) => p.name === name)!.image!;
    expect(by("با نسخه").variants).toBe(true);
    expect(by("بی‌نسخه")).not.toHaveProperty("variants");
  });

  it("the backfill makes the copies of older images, marks them, and is safe to repeat", async () => {
    const f = await fixture();
    const m = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    for (const k of variantKeysOf(m.key)) await f.deps.storage.delete(k);
    await prisma.media.update({ where: { id: m.id }, data: { variantsReady: false } }); // as an image uploaded before this feature
    const small = await uploadMedia(f.a.id, f.a1, await picture(300), f.deps);
    const r1 = await backfillVariants({ storage: f.deps.storage, log: quiet });
    expect(r1).toMatchObject({ done: 1, failed: 0 });
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m.id } })).variantsReady).toBe(true);
    expect(variantKeysOf(m.key).every((k) => f.deps.storage.objects.has(k))).toBe(true);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: small.id } })).variantsReady).toBe(false);
    const r2 = await backfillVariants({ storage: f.deps.storage, log: quiet });
    expect(r2.done).toBe(0); // nothing left to do (a small image is not retried over and over)
  });

  it("an image whose object is missing is reported, not marked", async () => {
    const f = await fixture();
    const m = await uploadMedia(f.a.id, f.a1, await picture(1600), f.deps);
    await prisma.media.update({ where: { id: m.id }, data: { variantsReady: false } });
    await f.deps.storage.delete(m.key);
    for (const k of variantKeysOf(m.key)) await f.deps.storage.delete(k);
    expect(await backfillVariants({ storage: f.deps.storage, log: quiet })).toMatchObject({ done: 0, failed: 1 });
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m.id } })).variantsReady).toBe(false);
  });
});
