import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryMediaStorage } from "@/test/memory-storage";
import { makeMedia, prisma, resetDb } from "@/test/db-helpers";
import { revision, twoTenants, validProduct } from "@/test/catalog-helpers";
import { MemoryRateLimiter } from "@/modules/auth/rate-limit";
import { createProduct, deleteProduct } from "@/modules/products/service";
import { NotFoundError } from "@/modules/stores/errors";
import { deleteStore } from "@/modules/stores/service";
import { runMediaCleanup } from "./cleanup";
import { MediaInUseError, MediaQuotaError, MediaRateLimitError, MediaStorageError, MediaValidationError } from "./errors";
import { MAX_MEDIA_BYTES_PER_STORE, MAX_MEDIA_PER_STORE } from "./limits";
import { processImage } from "./process";
import { attachProductImage, deleteMedia, detachProductImage, releaseMedia, removeStoreLogo, setStoreLogo, uploadMedia } from "./service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const photo = (w = 120, h = 90) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
const quiet = () => undefined;
const setup = () => ({ storage: new MemoryMediaStorage(), limiter: new MemoryRateLimiter(), log: quiet });
type Deps = ReturnType<typeof setup>;

async function uploaded(owner: string, store: string, deps: Deps) {
  return uploadMedia(owner, store, await photo(), deps);
}
const rows = (storeId: string) => prisma.media.findMany({ where: { storeId }, orderBy: { createdAt: "asc" } });
const mkProduct = async (owner: string, store: string) => (await createProduct(owner, store, validProduct())).id;

describe("uploadMedia", () => {
  it("validates, re-encodes, stores under a server-generated key and records the REAL output metadata", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const r0 = await revision(a1);
    const m = await uploaded(a.id, a1, deps);
    expect(m.key).toMatch(new RegExp(`^stores/${a1}/[0-9a-f]{32}\\.webp$`));
    expect(m.mimeType).toBe("image/webp");
    const [row] = await rows(a1);
    expect(row).toMatchObject({ id: m.id, status: "READY", uploadedById: a.id, mimeType: "image/webp", width: 120, height: 90 });
    const obj = deps.storage.objects.get(m.key)!;
    expect(obj.contentType).toBe("image/webp");
    expect(row!.sizeBytes).toBe(obj.body.length);
    expect((await sharp(obj.body).metadata()).format).toBe("webp");
    expect(await revision(a1)).toBeGreaterThan(r0);
  });

  it("keys are unpredictable: two uploads of the same file share nothing but the store prefix", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const [x, y] = [await uploaded(a.id, a1, deps), await uploaded(a.id, a1, deps)];
    expect(x.key).not.toBe(y.key);
    expect(x.key.split("/")[2]!.slice(0, 8)).not.toBe(y.key.split("/")[2]!.slice(0, 8));
  });

  it("a foreign or missing store is a NotFoundError: nothing is processed, stored or recorded", async () => {
    const { a, b, a1 } = await twoTenants();
    const deps = setup();
    for (const [owner, store] of [[b.id, a1], [a.id, "ckdoesnotexist000000000000"], [a.id, "../x"]] as const) {
      await expect(uploadMedia(owner, store, await photo(), deps)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(deps.storage.putCalls).toBe(0);
    expect(await prisma.media.count()).toBe(0);
  });

  it.each([
    ["SVG", () => Promise.resolve(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))],
    ["GIF", () => sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).gif().toBuffer()],
    ["polyglot", async () => Buffer.concat([await photo(), Buffer.from("PK\u0003\u0004")])],
    ["bomb", () => sharp({ create: { width: 6000, height: 5000, channels: 3, background: "red" } }).png().toBuffer()],
    ["empty", () => Promise.resolve(Buffer.alloc(0))],
  ])("rejects %s without touching storage or the database", async (_n, make) => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    await expect(uploadMedia(a.id, a1, await make(), deps)).rejects.toBeInstanceOf(MediaValidationError);
    expect(deps.storage.putCalls).toBe(0);
    expect(await prisma.media.count()).toBe(0);
  });

  it("rate limits per user AND store (the 21st upload in the window is refused, others are unaffected)", async () => {
    const { a, b, a1, a2, b1 } = await twoTenants();
    const deps = setup();
    const img = await photo(20, 20);
    for (let i = 0; i < 20; i++) await uploadMedia(a.id, a1, img, deps);
    await expect(uploadMedia(a.id, a1, img, deps)).rejects.toBeInstanceOf(MediaRateLimitError);
    expect(await prisma.media.count({ where: { storeId: a1 } })).toBe(20);
    await expect(uploadMedia(a.id, a2, img, deps)).resolves.toBeTruthy(); // same user, other store
    await expect(uploadMedia(b.id, b1, img, deps)).resolves.toBeTruthy(); // other user
  });
});

describe("quotas (server-side, concurrency-safe)", () => {
  it("refuses the 101st image and counts PENDING and DELETING reservations", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    for (let i = 0; i < MAX_MEDIA_PER_STORE - 2; i++) await makeMedia(a1, a.id);
    await makeMedia(a1, a.id, { status: "PENDING" });
    await makeMedia(a1, a.id, { status: "DELETING" });
    await expect(uploaded(a.id, a1, deps)).rejects.toMatchObject({ kind: "count" });
    expect(deps.storage.putCalls).toBe(0);
    expect(await prisma.media.count({ where: { storeId: a1 } })).toBe(MAX_MEDIA_PER_STORE);
  });

  it("refuses an image that would push the processed bytes over 100 MB", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const size = (await processImage(await photo())).sizeBytes;
    let left = MAX_MEDIA_BYTES_PER_STORE - size + 1;
    while (left > 0) {
      const s = Math.min(left, 5 * 1024 * 1024);
      await makeMedia(a1, a.id, { sizeBytes: s });
      left -= s;
    }
    await expect(uploaded(a.id, a1, deps)).rejects.toBeInstanceOf(MediaQuotaError);
    expect(await rows(a1).then((r) => r.length)).toBeGreaterThan(0);
    expect(deps.storage.objects.size).toBe(0);
  });

  it("concurrent uploads cannot exceed the count quota", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    for (let i = 0; i < MAX_MEDIA_PER_STORE - 2; i++) await makeMedia(a1, a.id);
    const img = await photo(30, 30);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => uploadMedia(a.id, a1, img, deps)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof MediaQuotaError)).toBe(true);
    expect(await prisma.media.count({ where: { storeId: a1 } })).toBe(MAX_MEDIA_PER_STORE);
    expect(deps.storage.objects.size).toBe(2);
  });

  it("concurrent uploads cannot exceed the byte quota", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const img = await photo(64, 64);
    const size = (await processImage(img)).sizeBytes;
    let left = MAX_MEDIA_BYTES_PER_STORE - 2 * size - Math.floor(size / 2); // room for exactly two
    while (left > 0) {
      const s = Math.min(left, 5 * 1024 * 1024);
      await makeMedia(a1, a.id, { sizeBytes: s });
      left -= s;
    }
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => uploadMedia(a.id, a1, img, deps)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const total = await prisma.media.aggregate({ where: { storeId: a1 }, _sum: { sizeBytes: true } });
    expect(total._sum.sizeBytes!).toBeLessThanOrEqual(MAX_MEDIA_BYTES_PER_STORE);
  });
});

describe("failure handling: storage and database are not atomic", () => {
  it("storage failure during upload leaves no row, no object and the quota untouched", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    deps.storage.failPut = new Error("S3 down");
    await expect(uploaded(a.id, a1, deps)).rejects.toBeInstanceOf(MediaStorageError);
    expect(await prisma.media.count()).toBe(0);
    expect(deps.storage.objects.size).toBe(0);
    deps.storage.failPut = null;
    await expect(uploaded(a.id, a1, deps)).resolves.toBeTruthy();
  });

  it("a write that is reported as failed but actually succeeded does not leave an orphan", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    deps.storage.afterPut = () => {
      throw new Error("timeout after the object was written");
    };
    await expect(uploaded(a.id, a1, deps)).rejects.toBeInstanceOf(MediaStorageError);
    expect(deps.storage.objects.size).toBe(0);
    expect(await prisma.media.count()).toBe(0);
  });

  it("database failure after a successful put removes the object and the reservation", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    deps.storage.afterPut = async () => {
      await prisma.media.deleteMany({ where: { storeId: a1 } }); // the PENDING -> READY update will find nothing
    };
    await expect(uploaded(a.id, a1, deps)).rejects.toThrow();
    expect(deps.storage.objects.size).toBe(0);
    expect(await prisma.media.count()).toBe(0);
  });

  it("if the compensating delete ALSO fails, the PENDING row survives and cleanup recovers the object after the grace period", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    deps.storage.afterPut = async () => {
      deps.storage.failDelete = new Error("S3 delete down");
      await prisma.media.updateMany({ where: { storeId: a1 }, data: { status: "DELETING" } }); // make markReady fail
    };
    await expect(uploaded(a.id, a1, deps)).rejects.toThrow();
    expect(deps.storage.objects.size).toBe(1);
    expect(await prisma.media.count({ where: { storeId: a1 } })).toBe(1); // the row that lets cleanup find the object

    deps.storage.failDelete = null;
    const t0 = Date.now();
    const young = await runMediaCleanup({ storage: deps.storage, now: () => new Date(t0 + 5 * 60_000), log: quiet });
    expect(deps.storage.objects.size).toBe(1); // within the grace period: untouched
    expect(young).toMatchObject({ deletingFinished: 0 });
    // the row is DELETING here (we forced it) and old enough once the clock moves on
    const r = await runMediaCleanup({ storage: deps.storage, now: () => new Date(t0 + 2 * 3600_000), log: quiet });
    expect(r.deletingFinished).toBe(1);
    expect(deps.storage.objects.size).toBe(0);
    expect(await prisma.media.count()).toBe(0);
  });
});

describe("references, detaching and reference-aware deletion", () => {
  it("attach -> detach removes the object and the row; replace releases the previous image", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const p = await mkProduct(a.id, a1);
    const m1 = await uploaded(a.id, a1, deps);
    await attachProductImage(a.id, a1, p, m1.id, deps);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p } })).imageId).toBe(m1.id);

    const m2 = await uploaded(a.id, a1, deps);
    await attachProductImage(a.id, a1, p, m2.id, deps); // replaces m1
    expect(await prisma.media.findUnique({ where: { id: m1.id } })).toBeNull();
    expect(deps.storage.objects.has(m1.key)).toBe(false);
    expect(deps.storage.objects.has(m2.key)).toBe(true);

    await detachProductImage(a.id, a1, p, deps);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p } })).imageId).toBeNull();
    expect(await prisma.media.count({ where: { storeId: a1 } })).toBe(0);
    expect(deps.storage.objects.size).toBe(0);
  });

  it("referenced media is never deleted: strict delete throws, release keeps it, and the database itself refuses", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const p = await mkProduct(a.id, a1);
    const m = await uploaded(a.id, a1, deps);
    await attachProductImage(a.id, a1, p, m.id, deps);

    await expect(deleteMedia(a.id, a1, m.id, deps)).rejects.toBeInstanceOf(MediaInUseError);
    expect(await releaseMedia(a.id, a1, m.id, deps)).toBe("kept");
    expect(deps.storage.objects.has(m.key)).toBe(true);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("READY");
    await expect(prisma.media.delete({ where: { id: m.id } })).rejects.toThrow(); // FK, even bypassing the service
  });

  it("an image shared by a product and the store logo survives until BOTH references are gone", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const p = await mkProduct(a.id, a1);
    const m = await uploaded(a.id, a1, deps);
    await attachProductImage(a.id, a1, p, m.id, deps);
    await setStoreLogo(a.id, a1, m.id, deps);
    await detachProductImage(a.id, a1, p, deps);
    expect(deps.storage.objects.has(m.key)).toBe(true); // still the logo
    await removeStoreLogo(a.id, a1, deps);
    expect(deps.storage.objects.has(m.key)).toBe(false);
    expect(await prisma.media.count()).toBe(0);
  });

  it("media mentioned by a page section or by a StoreVersion snapshot (published site) is kept", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const m = await uploaded(a.id, a1, deps);
    await prisma.page.update({ where: { storeId_type: { storeId: a1, type: "ABOUT" } }, data: { sections: [{ id: "s", type: "imageText", props: { imageId: m.id } }] } });
    expect(await releaseMedia(a.id, a1, m.id, deps)).toBe("kept");
    await prisma.page.update({ where: { storeId_type: { storeId: a1, type: "ABOUT" } }, data: { sections: [] } });

    const p = await mkProduct(a.id, a1);
    const m2 = await uploaded(a.id, a1, deps);
    await attachProductImage(a.id, a1, p, m2.id, deps);
    await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: { products: [{ image: { key: m2.key } }] } } });
    await detachProductImage(a.id, a1, p, deps); // draft no longer uses it, the published version still does
    expect(deps.storage.objects.has(m2.key)).toBe(true);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m2.id } })).status).toBe("READY");
    expect(await releaseMedia(a.id, a1, m.id, deps)).toBe("deleted"); // unreferenced now
  });

  it("storage deletion failure: the product is detached, the row stays DELETING, repeated cleanup converges", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const p = await mkProduct(a.id, a1);
    const m = await uploaded(a.id, a1, deps);
    await attachProductImage(a.id, a1, p, m.id, deps);
    deps.storage.failDelete = new Error("S3 delete down");
    await detachProductImage(a.id, a1, p, deps); // must not throw
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p } })).imageId).toBeNull();
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("DELETING");
    expect(deps.storage.objects.has(m.key)).toBe(true);
    await expect(attachProductImage(a.id, a1, p, m.id, deps)).rejects.toBeInstanceOf(NotFoundError); // tombstone is not attachable

    const later = () => new Date(Date.now() + 2 * 3600_000);
    const failing = await runMediaCleanup({ storage: deps.storage, now: later, log: quiet });
    expect(failing.failures).toBe(1);
    expect(deps.storage.objects.has(m.key)).toBe(true); // still consistent: row and object both still there

    deps.storage.failDelete = null;
    expect(await runMediaCleanup({ storage: deps.storage, now: later, log: quiet })).toMatchObject({ deletingFinished: 1, failures: 0 });
    expect(await prisma.media.count()).toBe(0);
    expect(deps.storage.objects.size).toBe(0);
    expect(await runMediaCleanup({ storage: deps.storage, now: later, log: quiet })).toEqual({ expiredPendingRemoved: 0, deletingFinished: 0, orphanObjectsRemoved: 0, objectsScanned: 0, failures: 0 });
  });

  it("deleting a product releases its image", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    // deleteProduct uses the configured storage; inject through the test seam
    const { setMediaStorageForTests } = await import("@/lib/storage");
    setMediaStorageForTests(deps.storage);
    try {
      const p = await mkProduct(a.id, a1);
      const m = await uploaded(a.id, a1, deps);
      await attachProductImage(a.id, a1, p, m.id, deps);
      await deleteProduct(a.id, a1, p);
      expect(await prisma.media.count()).toBe(0);
      expect(deps.storage.objects.size).toBe(0);
    } finally {
      setMediaStorageForTests(undefined);
    }
  });
});

describe("tenant isolation of references", () => {
  it("forged media ids cannot be attached: another tenant's, another store's, PENDING and DELETING media", async () => {
    const { a, b, a1, a2, b1 } = await twoTenants();
    const deps = setup();
    const pa = await mkProduct(a.id, a1);
    const mine = await uploaded(a.id, a1, deps);
    const theirs = await uploaded(b.id, b1, deps);
    const otherStoreSameOwner = await uploaded(a.id, a2, deps);
    const pending = await makeMedia(a1, a.id, { status: "PENDING" });
    const deleting = await makeMedia(a1, a.id, { status: "DELETING" });

    for (const id of [theirs.id, otherStoreSameOwner.id, pending.id, deleting.id, "ckfake00000000000000000000"]) {
      await expect(attachProductImage(a.id, a1, pa, id, deps), id).rejects.toBeInstanceOf(NotFoundError);
      await expect(setStoreLogo(a.id, a1, id, deps), id).rejects.toBeInstanceOf(NotFoundError);
    }
    expect((await prisma.product.findUniqueOrThrow({ where: { id: pa } })).imageId).toBeNull();
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).logoId).toBeNull();

    // another tenant cannot touch my product or release my media
    await expect(attachProductImage(b.id, a1, pa, mine.id, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(detachProductImage(b.id, a1, pa, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(releaseMedia(b.id, a1, mine.id, deps)).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.storage.objects.has(mine.key)).toBe(true);
    expect(deps.storage.objects.has(theirs.key)).toBe(true);
  });

  it("the database refuses cross-store references even when the application is bypassed", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    const pa = await mkProduct(a.id, a1);
    const foreign = await makeMedia(b1, b.id);
    await expect(prisma.product.update({ where: { id: pa }, data: { imageId: foreign.id } })).rejects.toThrow();
    await expect(prisma.store.update({ where: { id: a1 }, data: { logoId: foreign.id } })).rejects.toThrow();
    // and a key outside the store's own prefix is refused
    await expect(makeMedia(a1, a.id, { key: `stores/${b1}/${"a".repeat(32)}.webp` })).rejects.toThrow();
    await expect(makeMedia(a1, a.id, { key: "uploads/../../etc/passwd" })).rejects.toThrow();
  });
});

describe("store logo", () => {
  it("uses the same pipeline, can be replaced and removed, and the old image is released", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const m1 = await uploaded(a.id, a1, deps);
    await setStoreLogo(a.id, a1, m1.id, deps);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).logoId).toBe(m1.id);
    const m2 = await uploaded(a.id, a1, deps);
    await setStoreLogo(a.id, a1, m2.id, deps);
    expect(deps.storage.objects.has(m1.key)).toBe(false);
    await removeStoreLogo(a.id, a1, deps);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).logoId).toBeNull();
    expect(deps.storage.objects.size).toBe(0);
  });

  it("deleting a store that has a logo and product images works (cascade) and cleanup removes the orphaned objects", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const p = await mkProduct(a.id, a1);
    const logo = await uploaded(a.id, a1, deps);
    const img = await uploaded(a.id, a1, deps);
    await setStoreLogo(a.id, a1, logo.id, deps);
    await attachProductImage(a.id, a1, p, img.id, deps);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: a1 } });
    await deleteStore(a.id, a1, store.name);
    expect(await prisma.media.count({ where: { storeId: a1 } })).toBe(0);
    expect(deps.storage.objects.size).toBe(2); // the object store cannot be part of the DB cascade

    const t0 = Date.now();
    await runMediaCleanup({ storage: deps.storage, now: () => new Date(t0 + 60_000), log: quiet });
    expect(deps.storage.objects.size).toBe(2); // too young: could still belong to an upload in flight
    const r = await runMediaCleanup({ storage: deps.storage, now: () => new Date(t0 + 2 * 3600_000), log: quiet });
    expect(r.orphanObjectsRemoved).toBe(2);
    expect(deps.storage.objects.size).toBe(0);
  });
});

describe("cleanup", () => {
  it("never touches objects that have a row, young objects, or keys outside the media key format; a PENDING row of an active upload is protected by the grace period", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const keep = await uploaded(a.id, a1, deps);
    const pendingRow = await makeMedia(a1, a.id, { status: "PENDING" });
    deps.storage.objects.set(pendingRow.key, { body: Buffer.from("x"), contentType: "image/webp", lastModified: new Date() });
    deps.storage.objects.set("stores/someone/not-a-valid-key.txt", { body: Buffer.from("x"), contentType: "text/plain", lastModified: new Date(0) });
    deps.storage.objects.set(`stores/${a1}/${"b".repeat(32)}.webp`, { body: Buffer.from("x"), contentType: "image/webp", lastModified: new Date() }); // orphan, but young

    const now = () => new Date(Date.now() + 5 * 60_000);
    await runMediaCleanup({ storage: deps.storage, now, log: quiet });
    expect(deps.storage.objects.size).toBe(4);
    expect(await prisma.media.count()).toBe(2);

    const old = () => new Date(Date.now() + 3 * 3600_000);
    const r = await runMediaCleanup({ storage: deps.storage, now: old, log: quiet });
    expect(r.expiredPendingRemoved).toBe(1); // the crashed upload
    expect(r.orphanObjectsRemoved).toBe(1); // the row-less object
    expect(deps.storage.objects.has(pendingRow.key)).toBe(false);
    expect(deps.storage.objects.has("stores/someone/not-a-valid-key.txt")).toBe(true); // not ours, not touched
    // the READY image is untouched even though it is "old" now
    expect(await prisma.media.findUnique({ where: { id: keep.id } })).not.toBeNull();
    expect(deps.storage.objects.has(keep.key)).toBe(true);
  });

  it("a PENDING row that completes while cleanup runs is not removed (conditional claim)", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const row = await makeMedia(a1, a.id, { status: "PENDING" });
    deps.storage.objects.set(row.key, { body: Buffer.from("x"), contentType: "image/webp", lastModified: new Date(0) });
    await prisma.media.update({ where: { id: row.id }, data: { status: "READY" } }); // the upload finished
    const r = await runMediaCleanup({ storage: deps.storage, now: () => new Date(Date.now() + 3 * 3600_000), log: quiet });
    expect(r.expiredPendingRemoved).toBe(0);
    expect(deps.storage.objects.has(row.key)).toBe(true);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("READY");
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    deps.storage.objects.set(`stores/${a1}/${"c".repeat(32)}.webp`, { body: Buffer.from("x"), contentType: "image/webp", lastModified: new Date(0) });
    await makeMedia(a1, a.id, { status: "PENDING" });
    const now = () => new Date(Date.now() + 3 * 3600_000);
    const first = await runMediaCleanup({ storage: deps.storage, now, log: quiet });
    expect(first.orphanObjectsRemoved + first.expiredPendingRemoved).toBeGreaterThan(0);
    const second = await runMediaCleanup({ storage: deps.storage, now, log: quiet });
    expect(second).toEqual({ expiredPendingRemoved: 0, deletingFinished: 0, orphanObjectsRemoved: 0, objectsScanned: 0, failures: 0 });
  });
});
