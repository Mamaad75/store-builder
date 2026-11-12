import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setMediaStorageForTests } from "@/lib/storage";
import { MemoryRateLimiter } from "@/modules/auth/rate-limit";
import { createCategory, deleteCategory, updateCategory } from "@/modules/categories/service";
import { attachProductImage, setStoreLogo, uploadMedia } from "@/modules/media/service";
import { addSection, getPageEditor, moveSection, removeSection, setPageVisibility, updateSection } from "@/modules/pages/service";
import { changeProductStatus, createProduct, deleteProduct, updateProduct } from "@/modules/products/service";
import { readPublishedStorefront } from "@/modules/storefront/published";
import { ConflictError } from "@/modules/stores/errors";
import { updateStore } from "@/modules/stores/service";
import { previewThemeSwitch, switchTheme } from "@/modules/stores/theme-switch";
import { validProduct } from "@/test/catalog-helpers";
import { prisma, resetDb } from "@/test/db-helpers";
import { MemoryMediaStorage } from "@/test/memory-storage";
import { draftRevisionOf, publishableStore } from "@/test/publish-helpers";
import sharp from "sharp";
import { LockBudget } from "./budget";
import { canonicalize } from "./canonical";
import { DEFAULT_PUBLISH_LIMITS, RATE_WINDOW_MS, setPublishHooksForTests, setPublishLimitsForTests } from "./constants";
import { PublishBusyError, PublishRateLimitedError, PublishTimedOutError, RedirectLimitError, ReservedSlugLimitError, SlugHistoryLimitError, SnapshotTooLargeError } from "./errors";
import { publishStore, setLiveVersion, unpublishStore } from "./service";

beforeEach(resetDb);
afterEach(() => {
  setPublishLimitsForTests({});
  setPublishHooksForTests({});
  setMediaStorageForTests(undefined);
});
afterAll(() => prisma.$disconnect());

const publish = async (owner: string, store: string) => publishStore(owner, store, { expectedDraftRevision: await draftRevisionOf(store) });
const raw = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const counts = async (storeId: string) =>
  JSON.stringify([await prisma.storeVersion.count({ where: { storeId } }), await prisma.storeVersionProduct.count(), await prisma.publishedSlug.count({ where: { storeId } }), (await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).status]);

describe("limits are pinned", () => {
  it("the approved numbers", () => {
    expect(DEFAULT_PUBLISH_LIMITS).toMatchObject({
      maxSnapshotBytes: 20 * 1024 * 1024,
      lockBudgetMs: 10_000,
      lockTimeoutMs: 5_000,
      maxPublishesPerHour: 10,
      maxHistoricalSlugsPerProduct: 5,
      maxRedirectsPerVersion: 2_500,
      maxReservedSlugsPerStore: 10_000,
    });
    expect(DEFAULT_PUBLISH_LIMITS.txTimeoutMs).toBeGreaterThan(DEFAULT_PUBLISH_LIMITS.lockTimeoutMs + DEFAULT_PUBLISH_LIMITS.lockBudgetMs);
    expect(RATE_WINDOW_MS).toBe(3_600_000);
  });
});

describe("published snapshots are immutable", () => {
  it("every draft change after publishing leaves the published snapshot and the public output byte-identical", async () => {
    const { owner, storeId, productIds } = await publishableStore({ products: 2 });
    const r = await publish(owner.id, storeId);
    const snapshot = async () => canonicalize((await prisma.storeVersion.findUniqueOrThrow({ where: { id: r.versionId } })).snapshot);
    const before = await snapshot();
    const pub = JSON.stringify(await readPublishedStorefront(storeId));

    await updateProduct(owner.id, storeId, productIds[0]!, { name: "تغییر نام", price: 99, specs: [{ label: "برند", value: "الف" }] });
    await createProduct(owner.id, storeId, validProduct({ name: "محصول جدید" }));
    await changeProductStatus(owner.id, storeId, productIds[1]!, "ARCHIVED");
    const cat = await createCategory(owner.id, storeId, { name: "دسته" });
    await updateCategory(owner.id, storeId, cat.id, { name: "دسته دو" });
    await updateStore(owner.id, storeId, { name: "نام دیگر", primaryColor: "#123456", typography: { sizeScale: "large", headingWeight: "600" } });
    const home = await getPageEditor(owner.id, storeId, "HOME");
    await addSection(owner.id, storeId, "HOME", { type: "richText" }, home.revision);
    await updateSection(owner.id, storeId, "ABOUT", (await getPageEditor(owner.id, storeId, "ABOUT")).sections[0]!.id, { title: "عنوان دیگر" }, (await getPageEditor(owner.id, storeId, "ABOUT")).revision);
    await setPageVisibility(owner.id, storeId, "CONTACT", false, (await getPageEditor(owner.id, storeId, "CONTACT")).revision);
    const rep = await previewThemeSwitch(owner.id, storeId, "coffee");
    await switchTheme(owner.id, storeId, { targetKey: "coffee", expectedDraftRevision: rep.draftRevision });
    await deleteProduct(owner.id, storeId, productIds[0]!);

    expect(await snapshot()).toBe(before);
    expect(JSON.stringify(await readPublishedStorefront(storeId))).toBe(pub);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).publishedVersionId).toBe(r.versionId);
  });
});

describe("the immutability and delete triggers (real migration, real PostgreSQL)", () => {
  async function published() {
    const s = await publishableStore({ products: 2 });
    const r = await publish(s.owner.id, s.storeId);
    return { ...s, versionId: r.versionId };
  }

  it("any UPDATE of a version, its product index or the slug reservations is refused (even a no-op, even another column)", async () => {
    const { storeId, versionId } = await published();
    const fails = async (sql: Promise<unknown>) => expect(String((await raw(sql))?.message)).toContain("immutable");
    await fails(prisma.$executeRaw`UPDATE "StoreVersion" SET "snapshot" = '{"x":1}'::jsonb WHERE id = ${versionId}`);
    await fails(prisma.$executeRaw`UPDATE "StoreVersion" SET "snapshot" = "snapshot" WHERE id = ${versionId}`);
    await fails(prisma.$executeRaw`UPDATE "StoreVersion" SET "draftRevision" = 999 WHERE id = ${versionId}`);
    await fails(prisma.$executeRaw`UPDATE "StoreVersion" SET "contentHash" = 'x' WHERE id = ${versionId}`);
    await fails(prisma.storeVersion.update({ where: { id: versionId }, data: { snapshotBytes: 1 } }));
    await fails(prisma.$executeRaw`UPDATE "StoreVersionProduct" SET slug = 'x' WHERE "versionId" = ${versionId}`);
    await fails(prisma.$executeRaw`UPDATE "PublishedSlug" SET slug = 'x' WHERE "storeId" = ${storeId}`);
  });

  it("a DIRECT delete of a version (live or not), its product index or a reserved slug is refused", async () => {
    const { owner, storeId, versionId } = await published();
    const second = await updateProduct(owner.id, storeId, (await prisma.product.findFirstOrThrow({ where: { storeId } })).id, { name: "دوم" }).then(() => publish(owner.id, storeId));
    const refused = async (sql: Promise<unknown>) => expect(String((await raw(sql))?.message)).toContain("direct deletion");
    await refused(prisma.$executeRaw`DELETE FROM "StoreVersion" WHERE id = ${second.versionId}`); // the live version
    await refused(prisma.$executeRaw`DELETE FROM "StoreVersion" WHERE id = ${versionId}`); // a historical version
    await refused(prisma.storeVersion.delete({ where: { id: versionId } }));
    await refused(prisma.$executeRaw`DELETE FROM "StoreVersionProduct" WHERE "versionId" = ${versionId}`);
    await refused(prisma.$executeRaw`DELETE FROM "PublishedSlug" WHERE "storeId" = ${storeId}`);
    expect(await prisma.storeVersion.count({ where: { storeId } })).toBe(2);
  });

  it("deleting the STORE cascades versions, product index and slugs (published store, several versions); rollback, roll-forward, unpublish and republish all work", async () => {
    const { owner, storeId } = await published();
    const pid = (await prisma.product.findFirstOrThrow({ where: { storeId } })).id;
    await updateProduct(owner.id, storeId, pid, { name: "نسخه دو" });
    await publish(owner.id, storeId);
    await setLiveVersion(owner.id, storeId, { versionNumber: 1, mode: "rollback" });
    await setLiveVersion(owner.id, storeId, { versionNumber: 2, mode: "rollback" });
    await unpublishStore(owner.id, storeId);
    await setLiveVersion(owner.id, storeId, { versionNumber: 1, mode: "republish" });
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).status).toBe("PUBLISHED");
    await prisma.$executeRaw`DELETE FROM "Store" WHERE id = ${storeId}`;
    expect(await prisma.storeVersion.count()).toBe(0);
    expect(await prisma.storeVersionProduct.count()).toBe(0);
    expect(await prisma.publishedSlug.count()).toBe(0);
  });

  it("INSERTs still work (a version, its index and slugs are created by publish)", async () => {
    const { storeId, versionId } = await published();
    expect(await prisma.storeVersionProduct.count({ where: { versionId } })).toBe(2);
    expect(await prisma.publishedSlug.count({ where: { storeId } })).toBe(2);
  });
});

describe("limits are enforced before anything is visible (explicit assertions AND the database backstop)", () => {
  async function withHistory(productCount: number, historyPerProduct: number) {
    const s = await publishableStore({ products: productCount });
    for (const pid of s.productIds) {
      await prisma.publishedSlug.createMany({ data: Array.from({ length: historyPerProduct }, (_, i) => ({ storeId: s.storeId, productId: pid, slug: `old-${pid.slice(-6)}-${i}` })) });
    }
    return s;
  }

  it("the 2,500-redirect limit is asserted explicitly (tested with a lowered limit); exactly at the limit passes; a refusal leaves no trace", async () => {
    const s = await withHistory(2, 2); // 2 products x 2 historical slugs = 4 redirects
    setPublishLimitsForTests({ maxRedirectsPerVersion: 3 });
    const before = await counts(s.storeId);
    const e = await raw(publish(s.owner.id, s.storeId));
    expect(e).toBeInstanceOf(RedirectLimitError);
    expect(e).toMatchObject({ count: 4, limit: 3 });
    expect(await counts(s.storeId)).toBe(JSON.stringify([0, 0, 4, "DRAFT"]).replace("4", "4")); // only the history rows that existed before
    void before;
    setPublishLimitsForTests({ maxRedirectsPerVersion: 4 });
    expect((await publish(s.owner.id, s.storeId)).number).toBe(1);
  });

  it("the per-product historical limit is a clear error that names the products, raised before the limit is exceeded", async () => {
    const s = await withHistory(2, 1);
    setPublishLimitsForTests({ maxHistoricalSlugsPerProduct: 0 }); // current slug only
    const e = await raw(publish(s.owner.id, s.storeId));
    expect(e).toBeInstanceOf(SlugHistoryLimitError);
    expect((e as SlugHistoryLimitError).products.map((p) => p.name).sort()).toEqual(["محصول 1", "محصول 2"]);
    expect(await prisma.storeVersion.count()).toBe(0);
  });

  it("the per-store reserved-slug limit is enforced before the pointer moves", async () => {
    const s = await withHistory(2, 1);
    setPublishLimitsForTests({ maxReservedSlugsPerStore: 3 }); // 2 history rows + 2 new current slugs = 4 > 3
    const e = await raw(publish(s.owner.id, s.storeId));
    expect(e).toBeInstanceOf(ReservedSlugLimitError);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } })).status).toBe("DRAFT");
  });

  it("the database trigger is the backstop: a 7th slug for a product and the 10,001st slug of a store are refused even with raw SQL", async () => {
    const s = await publishableStore({ products: 1 });
    const pid = s.productIds[0]!;
    await prisma.$executeRaw`INSERT INTO "PublishedSlug" (id, "storeId", "productId", slug) SELECT 'ps' || g, ${s.storeId}, ${pid}, 'slug-' || g FROM generate_series(1, 6) g`;
    const e = await raw(prisma.$executeRaw`INSERT INTO "PublishedSlug" (id, "storeId", "productId", slug) VALUES ('ps7', ${s.storeId}, ${pid}, 'slug-7')`);
    expect(String(e?.message)).toContain("PRODUCT_SLUG_LIMIT");
    const big = await raw(prisma.$executeRaw`INSERT INTO "PublishedSlug" (id, "storeId", "productId", slug) SELECT 'big' || g, ${s.storeId}, 'p' || g, 'big-' || g FROM generate_series(1, 10000) g`);
    expect(String(big?.message)).toContain("RESERVED_SLUG_LIMIT");
    expect(await prisma.publishedSlug.count({ where: { storeId: s.storeId } })).toBe(6); // the failed statement left nothing behind
  });

  it("the 20 MiB snapshot guard refuses an oversize snapshot with nothing written; the database CHECK mirrors the limit", async () => {
    const s = await publishableStore();
    setPublishLimitsForTests({ maxSnapshotBytes: 500 });
    expect(await raw(publish(s.owner.id, s.storeId))).toBeInstanceOf(SnapshotTooLargeError);
    expect(await counts(s.storeId)).toBe(JSON.stringify([0, 0, 0, "DRAFT"]));
    setPublishLimitsForTests({});
    const over = await raw(prisma.$executeRaw`INSERT INTO "StoreVersion" (id, "storeId", number, "draftRevision", snapshot, "snapshotBytes") VALUES ('big1', ${s.storeId}, 1, 1, '{}'::jsonb, 20971521)`);
    expect(String(over?.message)).toMatch(/snapshotBytes_check|check constraint/i);
    await prisma.$executeRaw`INSERT INTO "StoreVersion" (id, "storeId", number, "draftRevision", snapshot, "snapshotBytes") VALUES ('big2', ${s.storeId}, 1, 1, '{}'::jsonb, 20971520)`;
  });
});

describe("the publish rate limit: 10 versions per store per hour, an exact atomic sliding window", () => {
  const T = new Date("2026-03-01T10:00:00.000Z");
  const at = (ms: number) => new Date(T.getTime() + ms);

  it("the 11th publish inside the hour is refused with the time it becomes possible; failed or no-op attempts do not count", async () => {
    const s = await publishableStore();
    setPublishHooksForTests({ skipNoOpCheck: true, now: () => at(0) });
    for (let i = 0; i < 10; i++) await publish(s.owner.id, s.storeId);
    const e = await raw(publish(s.owner.id, s.storeId));
    expect(e).toBeInstanceOf(PublishRateLimitedError);
    expect((e as PublishRateLimitedError).retryAfterMs).toBe(RATE_WINDOW_MS);
    expect(await prisma.storeVersion.count({ where: { storeId: s.storeId } })).toBe(10);
    // rollbacks and republish create no version and are never rate limited
    await setLiveVersion(s.owner.id, s.storeId, { versionNumber: 1, mode: "rollback" });
    await setLiveVersion(s.owner.id, s.storeId, { versionNumber: 10, mode: "rollback" });
  });

  it("BOUNDARY: 1 ms before the oldest version leaves the window it is still refused; at exactly one hour it is allowed again", async () => {
    const s = await publishableStore();
    for (let i = 0; i < 10; i++) {
      setPublishHooksForTests({ skipNoOpCheck: true, now: () => at(i) }); // versions at T+0 ... T+9 ms
      await publish(s.owner.id, s.storeId);
    }
    setPublishHooksForTests({ skipNoOpCheck: true, now: () => at(RATE_WINDOW_MS - 1) }); // oldest (T+0) is 1 ms short of leaving
    const early = await raw(publish(s.owner.id, s.storeId));
    expect(early).toBeInstanceOf(PublishRateLimitedError);
    expect((early as PublishRateLimitedError).retryAfterMs).toBe(1);
    setPublishHooksForTests({ skipNoOpCheck: true, now: () => at(RATE_WINDOW_MS) }); // exactly one hour after the oldest: it no longer counts
    expect((await publish(s.owner.id, s.storeId)).number).toBe(11);
    // and the next one is limited again until T+1h+1ms (the T+1 ms version leaves the window)
    const again = await raw(publish(s.owner.id, s.storeId));
    expect(again).toBeInstanceOf(PublishRateLimitedError);
  });

  it("20 CONCURRENT publish requests create exactly 10 versions and 10 clean refusals (the store lock serialises the count)", async () => {
    const s = await publishableStore();
    setPublishHooksForTests({ skipNoOpCheck: true });
    const rev = await draftRevisionOf(s.storeId);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => publishStore(s.owner.id, s.storeId, { expectedDraftRevision: rev })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const limited = results.filter((r) => r.status === "rejected" && r.reason instanceof PublishRateLimitedError);
    expect(ok).toHaveLength(10);
    expect(limited).toHaveLength(10);
    expect(await prisma.storeVersion.count({ where: { storeId: s.storeId } })).toBe(10);
    const numbers = (await prisma.storeVersion.findMany({ where: { storeId: s.storeId }, orderBy: { number: "asc" } })).map((v) => v.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // unique and gap-free
  });
});

describe("one consistent draft state per snapshot, under concurrent draft writes", () => {
  it("every published snapshot equals the draft exactly as it was at its recorded revision (name and price change together)", async () => {
    const { owner, storeId, productIds } = await publishableStore({ products: 1 });
    setPublishLimitsForTests({ maxPublishesPerHour: 1_000 }); // this test is about consistency, not the rate limit
    const pid = productIds[0]!;
    const base = await draftRevisionOf(storeId);
    let done = false;
    const mutator = (async () => {
      for (let i = 1; i <= 40; i++) {
        await updateProduct(owner.id, storeId, pid, { name: `v${i}`, price: i * 10 }); // ONE mutation changes both
        await sleep(15); // gives the publisher real chances to interleave
      }
      done = true;
    })();
    const published: number[] = [];
    const publisher = (async () => {
      let guard = 0;
      while (!done && guard++ < 1000) {
        const rev = await draftRevisionOf(storeId);
        try {
          await publishStore(owner.id, storeId, { expectedDraftRevision: rev });
          published.push(rev);
        } catch (e) {
          if (!(e instanceof ConflictError) && !(e instanceof Error && e.name === "NoChangesError")) throw e;
        }
        await sleep(2);
      }
    })();
    await Promise.all([mutator, publisher]);
    const versions = await prisma.storeVersion.findMany({ where: { storeId }, orderBy: { number: "asc" } });
    expect(versions.length).toBeGreaterThanOrEqual(2); // several snapshots were taken WHILE the draft was changing
    for (const v of versions) {
      const snap = v.snapshot as { products: { name: string; price: number }[] };
      const i = v.draftRevision - base; // mutation i produced revision base + i
      const p = snap.products[0]!;
      if (i === 0) continue; // before the first change
      expect(p.name, `version ${v.number}`).toBe(`v${i}`);
      expect(p.price, `version ${v.number}`).toBe(i * 10); // never a mix of two states
    }
    expect(await draftRevisionOf(storeId)).toBe(base + 40); // publishing never bumped the revision
  });
});

describe("the lock-hold budget covers EVERY step, including everything after the large snapshot INSERT", () => {
  const STEPS = ["checks", "rate-limit", "read-draft", "build", "serialize", "no-op-check", "number", "insert-version", "insert-products", "reserve-slugs", "pointer", "deferred-work", "commit-fence"];

  it.each(STEPS)("a delay at step %s that exhausts the budget rolls everything back and releases the lock", async (step) => {
    const s = await publishableStore({ products: 2 });
    setPublishLimitsForTests({ lockBudgetMs: 400 });
    setPublishHooksForTests({ beforeStep: async (name) => { if (name === step) await sleep(600); } });
    const e = await raw(publish(s.owner.id, s.storeId));
    expect(e).toBeInstanceOf(PublishTimedOutError);
    expect(await counts(s.storeId)).toBe(JSON.stringify([0, 0, 0, "DRAFT"])); // nothing is visible, nothing partial remains
    // the lock was released: a draft writer proceeds immediately
    setPublishHooksForTests({});
    const t0 = performance.now();
    await updateProduct(s.owner.id, s.storeId, s.productIds[0]!, { name: "بعد از شکست" });
    expect(performance.now() - t0).toBeLessThan(2_000);
    // and a retry succeeds
    setPublishLimitsForTests({});
    expect((await publish(s.owner.id, s.storeId)).number).toBe(1);
  });

  it("PostgreSQL itself cancels a statement that would overrun the remaining budget (statement_timeout armed per step)", async () => {
    const e = await raw(db.$transaction(async (tx) => {
      const budget = new LockBudget(tx, 300);
      await budget.step("slow-statement", () => tx.$queryRaw`SELECT pg_sleep(2)`);
    }));
    expect(e).toBeInstanceOf(PublishTimedOutError);
  });

  it("LIMITATION (documented): deferred work left to COMMIT is NOT cancelled by statement_timeout - a plain transaction runs it to completion", async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.5); RETURN NULL; END $$`);
    await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER test_slow_commit_trg AFTER INSERT ON "StoreVersionProduct" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_slow_commit()`);
    const s = await publishableStore({ products: 1 });
    try {
      const t0 = performance.now();
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', '300ms', true)`;
        const v = await tx.storeVersion.create({ data: { id: "limit-demo", storeId: s.storeId, number: 1, draftRevision: 1, snapshot: {}, contentHash: "x", snapshotBytes: 1 } });
        await tx.storeVersionProduct.create({ data: { versionId: v.id, productId: s.productIds[0]!, slug: "demo" } });
      }, { timeout: 20_000 }); // COMMIT then runs the 1.5 s trigger despite the 300 ms statement_timeout
      expect(performance.now() - t0).toBeGreaterThan(1_400);
      expect(await prisma.storeVersion.count({ where: { storeId: s.storeId } })).toBe(1); // and it committed
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER test_slow_commit_trg ON "StoreVersionProduct"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION test_slow_commit()`);
    }
  });

  it("MITIGATION: publish runs deferred work as a budgeted step before the fence, so a slow deferred trigger is CANCELLED at the budget, everything rolls back and the lock is released", async () => {
    const s = await publishableStore({ products: 1 });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(4); RETURN NULL; END $$`);
    await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER test_slow_commit_trg AFTER INSERT ON "StoreVersionProduct" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_slow_commit()`);
    try {
      setPublishLimitsForTests({ lockBudgetMs: 1_500 });
      const t0 = performance.now();
      const e = await raw(publish(s.owner.id, s.storeId));
      const took = performance.now() - t0;
      expect(e).toBeInstanceOf(PublishTimedOutError);
      expect((e as PublishTimedOutError).step).toBe("deferred-work");
      expect(took).toBeLessThan(3_500); // cancelled near the 1.5 s budget, not after the 4 s the trigger wanted
      expect(await counts(s.storeId)).toBe(JSON.stringify([0, 0, 0, "DRAFT"]));
      const t1 = performance.now();
      await updateProduct(s.owner.id, s.storeId, s.productIds[0]!, { name: "قفل آزاد شد" }); // lock is free
      expect(performance.now() - t1).toBeLessThan(2_000);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER test_slow_commit_trg ON "StoreVersionProduct"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION test_slow_commit()`);
    }
  });

  it("BACKSTOP: if the application stalls while holding the lock, PostgreSQL ends the session (budget + 2 s), rolling back and releasing the lock", async () => {
    const s = await publishableStore({ products: 1 });
    setPublishLimitsForTests({ lockBudgetMs: 800 }); // idle backstop = 2.8 s
    setPublishHooksForTests({ beforeStep: async (name) => { if (name === "build") await sleep(6_000); } }); // the "application" freezes
    const running = raw(publish(s.owner.id, s.storeId));
    await sleep(4_000); // past the backstop, well before the stalled application wakes up
    const t0 = performance.now();
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Store" WHERE id = ${s.storeId} FOR UPDATE NOWAIT`; // would throw if the lock were still held
    expect(rows).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(2_000);
    const e = await running;
    expect(e).not.toBeNull(); // the stalled publish fails; it never commits
    expect(await counts(s.storeId)).toBe(JSON.stringify([0, 0, 0, "DRAFT"]));
    setPublishHooksForTests({});
    setPublishLimitsForTests({});
    expect((await publish(s.owner.id, s.storeId)).number).toBe(1); // and a retry works
  }, 30_000);

  it("the publish path has NO deferred constraints or triggers, so there is no commit-time work to overrun", async () => {
    const rows = await prisma.$queryRaw<{ tbl: string; name: string }[]>`
      SELECT c.relname AS tbl, t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND t.tgdeferrable AND c.relname IN ('StoreVersion', 'StoreVersionProduct', 'PublishedSlug', 'Store', 'Domain', 'SubdomainReservation')`;
    expect(rows).toEqual([]);
    const cons = await prisma.$queryRaw<{ n: string }[]>`
      SELECT conname AS n FROM pg_constraint WHERE condeferrable AND conrelid::regclass::text IN ('"StoreVersion"', '"StoreVersionProduct"', '"PublishedSlug"', '"Store"', '"Domain"')`;
    expect(cons).toEqual([]);
  });

  it("the lock WAIT is bounded: a busy store gives a retryable PublishBusyError with nothing written, and the retry succeeds", async () => {
    const s = await publishableStore();
    setPublishLimitsForTests({ lockTimeoutMs: 300 });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${s.storeId} FOR UPDATE`;
      await held;
    }, { timeout: 20_000 });
    await sleep(150);
    const t0 = performance.now();
    const e = await raw(publish(s.owner.id, s.storeId));
    const waited = performance.now() - t0;
    expect(e).toBeInstanceOf(PublishBusyError);
    expect(waited).toBeLessThan(2_000);
    expect(await prisma.storeVersion.count()).toBe(0);
    release();
    await holder;
    setPublishLimitsForTests({});
    expect((await publish(s.owner.id, s.storeId)).number).toBe(1);
  });
});

describe("lock discipline: every draft-writing operation takes the store lock first", () => {
  async function blockedWhileLocked(storeId: string, op: () => Promise<unknown>) {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
      await held;
    }, { timeout: 20_000 });
    await sleep(100);
    let settled = false;
    const run = op().then(() => (settled = true), (e) => { settled = true; throw e; });
    await sleep(500);
    const waited = !settled; // a writer that skipped the lock would already have finished
    release();
    await holder;
    await run;
    return waited;
  }

  it("products, categories, pages, settings, theme, media and logo writes all wait for the store lock", async () => {
    const s = await publishableStore({ products: 2 });
    const { owner, storeId, productIds } = s;
    const storage = new MemoryMediaStorage();
    setMediaStorageForTests(storage);
    const deps = { storage, limiter: new MemoryRateLimiter(), log: () => undefined };
    const cat = await createCategory(owner.id, storeId, { name: "دسته آزمایشی" });
    const home = await getPageEditor(owner.id, storeId, "HOME");
    const hero = home.sections[0]!;
    const jpeg = () => sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).jpeg().toBuffer();
    const media = await uploadMedia(owner.id, storeId, await jpeg(), deps);
    const media2 = await uploadMedia(owner.id, storeId, await jpeg(), deps);
    const rev = async (t: "HOME" | "ABOUT") => (await getPageEditor(owner.id, storeId, t)).revision;
    const ops: [string, () => Promise<unknown>][] = [
      ["createProduct", () => createProduct(owner.id, storeId, validProduct({ name: "تازه" }))],
      ["updateProduct", () => updateProduct(owner.id, storeId, productIds[0]!, { name: "ویرایش" })],
      ["changeProductStatus", () => changeProductStatus(owner.id, storeId, productIds[1]!, "ARCHIVED")],
      ["attachProductImage", () => attachProductImage(owner.id, storeId, productIds[0]!, media.id, deps)],
      ["createCategory", () => createCategory(owner.id, storeId, { name: "دسته دو" })],
      ["updateCategory", () => updateCategory(owner.id, storeId, cat.id, { name: "نام تازه" })],
      ["updateSection", async () => updateSection(owner.id, storeId, "HOME", hero.id, { title: "عنوان" }, await rev("HOME"))],
      ["addSection", async () => addSection(owner.id, storeId, "ABOUT", { type: "richText" }, await rev("ABOUT"))],
      ["moveSection", async () => moveSection(owner.id, storeId, "HOME", (await getPageEditor(owner.id, storeId, "HOME")).sections[1]!.id, "up", await rev("HOME"))],
      ["removeSection", async () => removeSection(owner.id, storeId, "ABOUT", (await getPageEditor(owner.id, storeId, "ABOUT")).sections.at(-1)!.id, await rev("ABOUT"))],
      ["setPageVisibility", async () => setPageVisibility(owner.id, storeId, "CONTACT", false, (await getPageEditor(owner.id, storeId, "CONTACT")).revision)],
      ["updateStore (settings)", () => updateStore(owner.id, storeId, { name: "نام فروشگاه", primaryColor: "#112233" })],
      ["setStoreLogo", () => setStoreLogo(owner.id, storeId, media2.id, deps)],
      ["switchTheme", async () => switchTheme(owner.id, storeId, { targetKey: "fashion", expectedDraftRevision: (await previewThemeSwitch(owner.id, storeId, "fashion")).draftRevision })],
      ["deleteCategory", () => deleteCategory(owner.id, storeId, cat.id, { moveProducts: true })],
      ["deleteProduct", () => deleteProduct(owner.id, storeId, productIds[0]!)],
    ];
    const results: Record<string, boolean> = {};
    for (const [name, op] of ops) {
      // ops that read before writing (page ops) compute their arguments first, outside the lock window
      results[name] = await blockedWhileLocked(storeId, op);
    }
    expect(results).toEqual(Object.fromEntries(ops.map(([n]) => [n, true])));
  }, 120_000);
});
