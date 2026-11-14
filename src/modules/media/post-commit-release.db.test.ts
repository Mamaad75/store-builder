import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMediaStorageForTests } from "@/lib/storage";
import { MemoryRateLimiter } from "@/modules/auth/rate-limit";
import { createProduct, deleteProduct } from "@/modules/products/service";
import { NotFoundError } from "@/modules/stores/errors";
import { revision, twoTenants, validProduct } from "@/test/catalog-helpers";
import { makeMedia, prisma, resetDb } from "@/test/db-helpers";
import { MemoryMediaStorage } from "@/test/memory-storage";
import { runMediaCleanup } from "./cleanup";
import { attachProductImage, detachProductImage, releaseMediaBestEffort, removeStoreLogo, setStoreLogo, uploadMedia } from "./service";

beforeEach(resetDb);
afterEach(() => {
  vi.restoreAllMocks();
  setMediaStorageForTests(undefined);
});
afterAll(() => prisma.$disconnect());

const photo = () => sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 60, b: 10 } } }).jpeg().toBuffer();
const logs: string[] = [];
const setup = () => {
  logs.length = 0;
  const storage = new MemoryMediaStorage();
  setMediaStorageForTests(storage); // code paths without explicit deps (deleteProduct, page edits) use the global storage
  return { storage, limiter: new MemoryRateLimiter(), log: (m: string) => void logs.push(m) };
};
type Deps = ReturnType<typeof setup>;
const upload = async (owner: string, store: string, deps: Deps) => uploadMedia(owner, store, await photo(), deps);
const mkProduct = async (owner: string, store: string) => (await createProduct(owner, store, validProduct())).id;
const later = () => new Date(Date.now() + 2 * 3600_000);
const status = async (id: string) => (await prisma.media.findUnique({ where: { id } }))?.status ?? null;

/**
 * Real PostgreSQL failure injection: the step "mark the old image DELETING" (the first step of a release) fails with the given
 * SQLSTATE. 55P03 is what a lock timeout looks like (DraftBusyError); XX000 is a generic database failure.
 */
async function injectReleaseFailure(sqlstate: string) {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION test_block_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${sqlstate === "55P03" ? "canceling statement due to lock timeout" : "injected release failure"}' USING ERRCODE = '${sqlstate}'; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER test_block_release_trg BEFORE UPDATE ON "Media" FOR EACH ROW WHEN (OLD.status = 'READY' AND NEW.status = 'DELETING') EXECUTE FUNCTION test_block_release()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_block_release_trg ON "Media"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_block_release()`);
  };
}

const FAILURES: [string, string, string][] = [
  ["the store is busy (lock timeout)", "55P03", "store_busy"],
  ["a database error", "XX000", "error"],
];

describe.each(FAILURES)("a committed media mutation is never reported as failed when the follow-up release fails: %s", (_label, sqlstate, reason) => {
  it("attach (replace), detach, logo replace/remove and product delete all succeed; the failure is logged; cleanup reclaims the old image without touching the draft revision", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const p1 = await mkProduct(a.id, a1);
    const p2 = await mkProduct(a.id, a1);
    const p3 = await mkProduct(a.id, a1);

    const oldA = await upload(a.id, a1, deps);
    const newA = await upload(a.id, a1, deps);
    await attachProductImage(a.id, a1, p1, oldA.id, deps);
    const oldB = await upload(a.id, a1, deps);
    await attachProductImage(a.id, a1, p2, oldB.id, deps);
    const oldLogo = await upload(a.id, a1, deps);
    await setStoreLogo(a.id, a1, oldLogo.id, deps);
    const newLogo = await upload(a.id, a1, deps);
    const oldC = await upload(a.id, a1, deps);
    await attachProductImage(a.id, a1, p3, oldC.id, deps);

    const restore = await injectReleaseFailure(sqlstate);
    try {
      await attachProductImage(a.id, a1, p1, newA.id, deps); // replace: must NOT throw
      await detachProductImage(a.id, a1, p2, deps); // must NOT throw
      await setStoreLogo(a.id, a1, newLogo.id, deps); // replace logo
      await deleteProduct(a.id, a1, p3); // uses the default logger (console.error)
    } finally {
      await restore();
    }

    // the committed changes are all in place
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p1 } })).imageId).toBe(newA.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p2 } })).imageId).toBeNull();
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).logoId).toBe(newLogo.id);
    expect(await prisma.product.count({ where: { id: p3 } })).toBe(0);
    // the old images were NOT released: READY, unreferenced, objects still there
    for (const m of [oldA, oldB, oldLogo, oldC]) {
      expect(await status(m.id)).toBe("READY");
      expect(deps.storage.objects.has(m.key)).toBe(true);
    }
    // observable: one structured line per failure, naming store, media, reason and the recovery path
    const events = [...logs, ...errorSpy.mock.calls.map((c) => String(c[0]))].map((l) => l.replace(/^\[media\] /, "")).filter((l) => l.includes("media.release_failed"));
    expect(events).toHaveLength(4);
    const names: Record<string, string> = { [oldA.id]: "attach-replace", [oldB.id]: "detach", [oldLogo.id]: "logo-replace", [oldC.id]: "deleteProduct" };
    for (const line of events) expect(JSON.parse(line), `${names[JSON.parse(line).mediaId]}: ${line}`).toMatchObject({ event: "media.release_failed", storeId: a1, reason, recovery: "pnpm media:cleanup" });
    expect(new Set(events.map((l) => JSON.parse(l).mediaId))).toEqual(new Set([oldA.id, oldB.id, oldLogo.id, oldC.id]));

    // reconciliation: a young unreferenced image is left alone; after the grace period the cleanup reclaims all four
    const rev = await revision(a1);
    const young = await runMediaCleanup({ storage: deps.storage, log: () => undefined });
    expect(young).toMatchObject({ unreferencedReadyReclaimed: 0, failures: 0 });
    const report = await runMediaCleanup({ storage: deps.storage, now: later, log: () => undefined });
    expect(report).toMatchObject({ unreferencedReadyReclaimed: 4, failures: 0, scanTruncated: false });
    for (const m of [oldA, oldB, oldLogo, oldC]) {
      expect(await status(m.id)).toBeNull();
      expect(deps.storage.objects.has(m.key)).toBe(false);
    }
    // images in use are untouched, and the background reclaim did not bump the draft revision
    for (const m of [newA, newLogo]) {
      expect(await status(m.id)).toBe("READY");
      expect(deps.storage.objects.has(m.key)).toBe(true);
    }
    expect(await revision(a1)).toBe(rev);
    // idempotent
    expect(await runMediaCleanup({ storage: deps.storage, now: later, log: () => undefined })).toMatchObject({ unreferencedReadyReclaimed: 0, failures: 0, deletingFinished: 0 });
  }, 60_000);

  it("removeStoreLogo too", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const logo = await upload(a.id, a1, deps);
    await setStoreLogo(a.id, a1, logo.id, deps);
    const restore = await injectReleaseFailure(sqlstate);
    try {
      await removeStoreLogo(a.id, a1, deps);
    } finally {
      await restore();
    }
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).logoId).toBeNull();
    expect(await status(logo.id)).toBe("READY");
    expect(logs.some((l) => l.includes("media.release_failed"))).toBe(true);
    expect(await runMediaCleanup({ storage: deps.storage, now: later, log: () => undefined })).toMatchObject({ unreferencedReadyReclaimed: 1 });
    expect(deps.storage.objects.size).toBe(0);
  });
});

describe("releaseMediaBestEffort", () => {
  it("returns the normal outcome when nothing is wrong, and 'deferred' (never throws) when the release cannot start", async () => {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const m = await upload(a.id, a1, deps);
    expect(await releaseMediaBestEffort(a.id, a1, m.id, deps)).toBe("deleted");
    expect(await releaseMediaBestEffort(a.id, a1, m.id, deps)).toBe("gone"); // idempotent
    const m2 = await upload(a.id, a1, deps);
    const restore = await injectReleaseFailure("XX000");
    try {
      expect(await releaseMediaBestEffort(a.id, a1, m2.id, deps)).toBe("deferred");
    } finally {
      await restore();
    }
    expect(await status(m2.id)).toBe("READY");
  });
});

describe("cleanup step 4 (reclaim of unreferenced READY media) is reference-aware and safe", () => {
  async function world() {
    const { a, a1 } = await twoTenants();
    const deps = setup();
    const obj = (key: string) => deps.storage.objects.set(key, { body: Buffer.from("x"), contentType: "image/webp", lastModified: new Date(0) });
    const media = async () => {
      const m = await makeMedia(a1, a.id, { status: "READY" });
      obj(m.key);
      return m;
    };
    return { a, a1, deps, media };
  }
  const kept = async (deps: Deps, m: { id: string; key: string }) => (await status(m.id)) === "READY" && deps.storage.objects.has(m.key);

  it("reclaims only truly unreferenced media: product image, logo, page section, archived section and published snapshot all protect their media", async () => {
    const { a, a1, deps, media } = await world();
    const unreferenced = await media();
    const product = await media();
    const logo = await media();
    const section = await media();
    const archived = await media();
    const snapshot = await media();
    const pid = await mkProduct(a.id, a1);
    await prisma.product.update({ where: { id: pid }, data: { imageId: product.id } });
    await prisma.store.update({ where: { id: a1 }, data: { logoId: logo.id } });
    const [pageA, pageB] = await prisma.page.findMany({ where: { storeId: a1 }, take: 2 });
    await prisma.page.update({ where: { id: pageA!.id }, data: { sections: [{ id: "s1", type: "hero", props: { imageId: section.id } }] } });
    await prisma.page.update({ where: { id: pageB!.id }, data: { legacySections: [{ id: "old", props: { imageId: archived.id } }] } });
    await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: { image: snapshot.key } } });

    const report = await runMediaCleanup({ storage: deps.storage, now: later, log: () => undefined });
    expect(report).toMatchObject({ unreferencedReadyReclaimed: 1, failures: 0 });
    expect(await status(unreferenced.id)).toBeNull();
    expect(deps.storage.objects.has(unreferenced.key)).toBe(false);
    for (const m of [product, logo, section, archived, snapshot]) expect(await kept(deps, m), m.key).toBe(true);
  });

  it("a reclaimed image can no longer be attached (the DELETING tombstone is taken under the store lock)", async () => {
    const { a, a1, deps, media } = await world();
    const m = await media();
    await runMediaCleanup({ storage: deps.storage, now: later, log: () => undefined });
    await expect(attachProductImage(a.id, a1, await mkProduct(a.id, a1), m.id, deps)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a storage failure during reclaim is counted and logged, leaves a DELETING row, and the next run finishes it", async () => {
    const { a1, deps, media } = await world();
    const m = await media();
    deps.storage.failDelete = new Error("S3 down");
    const failing = await runMediaCleanup({ storage: deps.storage, now: later, log: (msg) => void logs.push(msg) });
    expect(failing.failures).toBeGreaterThan(0);
    expect(await status(m.id)).toBe("DELETING");
    expect(deps.storage.objects.has(m.key)).toBe(true);
    deps.storage.failDelete = null;
    const ok = await runMediaCleanup({ storage: deps.storage, now: later, log: () => undefined });
    expect(ok).toMatchObject({ deletingFinished: 1, failures: 0 });
    expect(await status(m.id)).toBeNull();
    expect(deps.storage.objects.has(m.key)).toBe(false);
    expect(a1).toBeTruthy();
  });

  it("the scan is bounded per run and reports truncation; the remaining candidates are examined by later runs", async () => {
    const { a1, deps, media } = await world();
    const ms = [await media(), await media(), await media()];
    await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: { images: ms.map((m) => m.key) } } }); // all three protected
    const r = await runMediaCleanup({ storage: deps.storage, now: later, maxScan: 2, log: () => undefined });
    expect(r).toMatchObject({ unreferencedReadyScanned: 2, scanTruncated: true, unreferencedReadyReclaimed: 0 });
  });
});
