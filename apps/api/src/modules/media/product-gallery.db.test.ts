import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "../../lib/rate-limit.js";
import { setMediaStorageForTests } from "../../lib/storage/index.js";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { GALLERY_FULL_MESSAGE } from "@store-builder/shared/modules/products/gallery";
import { twoTenants, validProduct } from "../../test/catalog-helpers.js";
import { prisma, resetDb } from "../../test/db-helpers.js";
import { MemoryMediaStorage } from "../../test/memory-storage.js";
import { createProduct, deleteProduct, getProduct } from "../products/service.js";
import { getDraftPreview } from "../storefront/service.js";
import { runMediaCleanup } from "./cleanup.js";
import { uploadProductGalleryImage } from "./orchestration.js";
import { addProductGalleryImage, deleteMedia, detachProductImage, makeGalleryImagePrimary, releaseMedia, removeProductGalleryImage, uploadMedia } from "./service.js";

/**
 * The product gallery on real PostgreSQL: the first image is the product's own (imageId), up to five more follow at positions 1..5. Every
 * step runs under the store lock and the media lifecycle keeps working: an image still used by a gallery is never deleted, and an image no
 * longer used is released (object and row).
 */
beforeEach(resetDb);
afterEach(() => setMediaStorageForTests(undefined));
afterAll(() => prisma.$disconnect());

const photo = (n = 0) => sharp({ create: { width: 120 + n, height: 90, channels: 3, background: { r: 10 + n * 20, g: 120, b: 200 } } }).jpeg().toBuffer();
const quiet = () => undefined;
const setup = () => ({ storage: new MemoryMediaStorage(), limiter: new MemoryRateLimiter(), log: quiet });

async function fixture() {
  const { a, b, a1, b1 } = await twoTenants();
  const deps = setup();
  setMediaStorageForTests(deps.storage);
  const product = (await createProduct(a.id, a1, validProduct())).id;
  const up = async (n = 0, owner = a.id, store = a1) => uploadMedia(owner, store, await photo(n), deps);
  /** The product as the dashboard reads it: its own image first, then the extras in order. */
  const images = async () => {
    const p = await getProduct(a.id, a1, product);
    return [p.image?.id, ...p.gallery.map((g) => g.media.id)].filter(Boolean) as string[];
  };
  return { a, b, a1, b1, product, deps, up, images };
}
const mediaCount = (storeId: string) => prisma.media.count({ where: { storeId } });

describe("adding images", () => {
  it("the first upload becomes the product's own image, the next five the extras in order; the seventh is refused and released", async () => {
    const f = await fixture();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const m = await f.up(i);
      await addProductGalleryImage(f.a.id, f.a1, f.product, m.id);
      ids.push(m.id);
    }
    expect(await f.images()).toEqual(ids);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.product } })).imageId).toBe(ids[0]);
    expect((await prisma.productImage.findMany({ where: { productId: f.product }, orderBy: { position: "asc" } })).map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);

    // the seventh, through the real upload path: refused with the reason, nothing left behind
    const before = await mediaCount(f.a1);
    const objectsBefore = f.deps.storage.objects.size;
    await expect(uploadProductGalleryImage(f.a.id, f.a1, f.product, await photo(9))).rejects.toMatchObject({ fieldErrors: { image: [GALLERY_FULL_MESSAGE] } });
    expect(await mediaCount(f.a1)).toBe(before);
    expect(f.deps.storage.objects.size).toBe(objectsBefore);
    expect(await f.images()).toEqual(ids);
  });

  it("adding the same image twice, or its own image, changes nothing", async () => {
    const f = await fixture();
    const m1 = await f.up(1);
    const m2 = await f.up(2);
    await addProductGalleryImage(f.a.id, f.a1, f.product, m1.id);
    await addProductGalleryImage(f.a.id, f.a1, f.product, m2.id);
    await addProductGalleryImage(f.a.id, f.a1, f.product, m2.id);
    await addProductGalleryImage(f.a.id, f.a1, f.product, m1.id);
    expect(await f.images()).toEqual([m1.id, m2.id]);
  });

  it("eight uploads at once never exceed six images or reuse a position", async () => {
    const f = await fixture();
    const medias = [];
    for (let i = 0; i < 8; i++) medias.push(await f.up(i));
    const results = await Promise.allSettled(medias.map((m) => addProductGalleryImage(f.a.id, f.a1, f.product, m.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof ValidationError)).toBe(true);
    expect(await f.images()).toHaveLength(6);
    const positions = (await prisma.productImage.findMany({ where: { productId: f.product } })).map((r) => r.position).sort();
    expect(positions).toEqual([1, 2, 3, 4, 5]);
  });

  it("another store's product or another store's image is a plain not found", async () => {
    const f = await fixture();
    const other = await createProduct(f.b.id, f.b1, validProduct());
    const foreignMedia = await uploadMedia(f.b.id, f.b1, await photo(3), f.deps);
    const mine = await f.up(1);
    await expect(addProductGalleryImage(f.a.id, f.a1, other.id, mine.id)).rejects.toBeInstanceOf(NotFoundError); // not my product
    await expect(addProductGalleryImage(f.a.id, f.a1, f.product, foreignMedia.id)).rejects.toBeInstanceOf(NotFoundError); // not my image
    await expect(addProductGalleryImage(f.b.id, f.b1, f.product, foreignMedia.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.productImage.count()).toBe(0);
  });
});

describe("removing, promoting and deleting", () => {
  async function three(f: Awaited<ReturnType<typeof fixture>>) {
    const ms = [await f.up(1), await f.up(2), await f.up(3)];
    for (const m of ms) await addProductGalleryImage(f.a.id, f.a1, f.product, m.id);
    return ms.map((m) => m.id);
  }

  it("removing an extra releases its file and row, and the freed position is reused by the next image", async () => {
    const f = await fixture();
    const [m1, m2, m3] = await three(f);
    await removeProductGalleryImage(f.a.id, f.a1, f.product, m2!, f.deps);
    expect(await f.images()).toEqual([m1, m3]);
    expect(await prisma.media.count({ where: { id: m2 } })).toBe(0);
    const m4 = await f.up(4);
    await addProductGalleryImage(f.a.id, f.a1, f.product, m4.id);
    expect((await prisma.productImage.findUniqueOrThrow({ where: { productId_mediaId: { productId: f.product, mediaId: m4.id } } })).position).toBe(1); // the gap
    await expect(removeProductGalleryImage(f.a.id, f.a1, f.product, m1!, f.deps)).rejects.toBeInstanceOf(NotFoundError); // the product's OWN image is not an extra
  });

  it("making an extra the main image swaps it with the old one; both stay in use", async () => {
    const f = await fixture();
    const [m1, m2, m3] = await three(f);
    await makeGalleryImagePrimary(f.a.id, f.a1, f.product, m3!);
    expect(await f.images()).toEqual([m3, m2, m1]); // m3 is the main image; the old main took m3's place (position 2)
    expect(await prisma.media.count({ where: { id: { in: [m1!, m2!, m3!] }, status: "READY" } })).toBe(3);
    await expect(makeGalleryImagePrimary(f.a.id, f.a1, f.product, m3!)).rejects.toBeInstanceOf(NotFoundError); // already the main image
  });

  it("removing the main image promotes the first extra, so a product with pictures keeps a main one", async () => {
    const f = await fixture();
    const [m1, m2, m3] = await three(f);
    await detachProductImage(f.a.id, f.a1, f.product, f.deps);
    expect(await f.images()).toEqual([m2, m3]);
    expect(await prisma.media.count({ where: { id: m1 } })).toBe(0); // the old main image is released
    expect(await prisma.productImage.count({ where: { productId: f.product } })).toBe(1);
  });

  it("deleting the product releases its main image and every extra", async () => {
    const f = await fixture();
    await three(f);
    expect(f.deps.storage.objects.size).toBeGreaterThanOrEqual(3);
    await deleteProduct(f.a.id, f.a1, f.product);
    expect(await prisma.productImage.count()).toBe(0);
    expect(await mediaCount(f.a1)).toBe(0);
    expect(f.deps.storage.objects.size).toBe(0);
  });
});

describe("the media lifecycle protects gallery images", () => {
  it("an extra image is 'in use': releasing it keeps it, and the cleanup never reclaims it, while a truly unused image is reclaimed", async () => {
    const f = await fixture();
    const main = await f.up(1);
    const extra = await f.up(2);
    const unused = await f.up(3);
    await addProductGalleryImage(f.a.id, f.a1, f.product, main.id);
    await addProductGalleryImage(f.a.id, f.a1, f.product, extra.id);

    expect(await releaseMedia(f.a.id, f.a1, extra.id, f.deps)).toBe("kept"); // the lenient release keeps a used image
    await expect(deleteMedia(f.a.id, f.a1, extra.id, f.deps)).rejects.toMatchObject({ name: "MediaInUseError" }); // the strict one refuses it
    expect(await prisma.media.count({ where: { id: extra.id, status: "READY" } })).toBe(1);

    const later = new Date(Date.now() + 3 * 3_600_000); // past the grace period
    const report = await runMediaCleanup({ storage: f.deps.storage, now: () => later, log: quiet });
    expect(report.unreferencedReadyReclaimed).toBe(1); // only the unused one
    expect(await prisma.media.count({ where: { id: unused.id } })).toBe(0);
    expect(await prisma.media.count({ where: { id: { in: [main.id, extra.id] }, status: "READY" } })).toBe(2);
    expect(await f.images()).toEqual([main.id, extra.id]);
  });

  it("the database itself refuses to delete a media row that a gallery uses", async () => {
    const f = await fixture();
    const main = await f.up(1);
    const extra = await f.up(2);
    await addProductGalleryImage(f.a.id, f.a1, f.product, main.id);
    await addProductGalleryImage(f.a.id, f.a1, f.product, extra.id);
    await expect(prisma.media.delete({ where: { id: extra.id } })).rejects.toThrow();
    await expect(prisma.productImage.create({ data: { storeId: f.a1, productId: f.product, mediaId: main.id, position: 6 } })).rejects.toThrow(); // position 1..5 only
  });
});

describe("what the shopper-facing data carries", () => {
  it("the draft storefront data lists the extras after the main image, in order; a product without a gallery has no `gallery` key at all", async () => {
    const f = await fixture();
    const plain = await createProduct(f.a.id, f.a1, validProduct({ name: "ساده" }));
    for (const p of [f.product, plain.id]) await prisma.product.update({ where: { id: p }, data: { status: "ACTIVE" } });
    const [m1, m2, m3] = [await f.up(1), await f.up(2), await f.up(3)];
    for (const m of [m1, m2, m3]) await addProductGalleryImage(f.a.id, f.a1, f.product, m.id);
    const data = (await getDraftPreview(f.a.id, f.a1)).data;
    const withGallery = data.products.find((p) => p.id === f.product)!;
    expect(withGallery.image?.key).toBe(m1.key);
    expect(withGallery.gallery?.map((g) => g.key)).toEqual([m2.key, m3.key]);
    const without = data.products.find((p) => p.id === plain.id)!;
    expect("gallery" in without).toBe(false); // byte-for-byte what it was before the gallery existed
  });
});
