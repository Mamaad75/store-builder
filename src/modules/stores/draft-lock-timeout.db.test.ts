import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createCategory } from "@/modules/categories/service";
import { setPublishHooksForTests, setPublishLimitsForTests } from "@/modules/publishing/constants";
import { publishStore } from "@/modules/publishing/service";
import { updateProduct } from "@/modules/products/service";
import { prisma, resetDb } from "@/test/db-helpers";
import { draftRevisionOf, publishableStore } from "@/test/publish-helpers";
import { DRAFT_BUSY_MESSAGE, DraftBusyError } from "./errors";
import { DRAFT_LOCK_TIMEOUT_MS, setDraftLockTimeoutForTests, withStoreMutation } from "./mutation";
import { updateStore } from "./service";

beforeEach(resetDb);
afterEach(() => {
  setDraftLockTimeoutForTests();
  setPublishHooksForTests({});
  setPublishLimitsForTests({});
});
afterAll(() => prisma.$disconnect());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const raw = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);
const publish = async (owner: string, store: string) => publishStore(owner, store, { expectedDraftRevision: await draftRevisionOf(store) });

/** Holds the store row lock in a separate transaction until `release()` (stands in for any competing writer). */
function holdStoreLock(storeId: string) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const done = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
    await held;
  }, { timeout: 30_000 });
  return { release, done };
}

const productName = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).name;

describe("the draft lock timeout is pinned", () => {
  it("is 5 seconds by default", () => {
    expect(DRAFT_LOCK_TIMEOUT_MS).toBe(5_000);
  });
  it("the error is typed, retryable and has a Persian owner message", () => {
    const e = new DraftBusyError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("DraftBusyError");
    expect(e.retryable).toBe(true);
    expect(DRAFT_BUSY_MESSAGE).toMatch(/دوباره تلاش کنید/);
  });
});

describe("1. ordinary draft mutations work normally when nothing competes", () => {
  it("products, categories and settings change, the revision moves by exactly one per change, and no timeout leaks to the connection", async () => {
    const s = await publishableStore({ products: 1 });
    const r0 = await draftRevisionOf(s.storeId);
    await updateProduct(s.owner.id, s.storeId, s.productIds[0]!, { name: "نام جدید" });
    expect(await productName(s.productIds[0]!)).toBe("نام جدید");
    expect(await draftRevisionOf(s.storeId)).toBe(r0 + 1);
    await createCategory(s.owner.id, s.storeId, { name: "دسته تازه" });
    expect(await draftRevisionOf(s.storeId)).toBe(r0 + 2);
    await updateStore(s.owner.id, s.storeId, { name: "فروشگاه تازه" });
    expect(await draftRevisionOf(s.storeId)).toBe(r0 + 3);
    // the timeout is transaction-local: pooled connections keep PostgreSQL's default (0 = none)
    for (let i = 0; i < 4; i++) {
      const [row] = await prisma.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`;
      expect(row!.lock_timeout).toBe("0");
    }
  });
});

describe("2. a draft writer waiting behind a real publishing transaction", () => {
  it("waits for the publish (within the timeout) and then succeeds; the snapshot has the state from before the change", async () => {
    const s = await publishableStore({ products: 1 });
    const before = await productName(s.productIds[0]!);
    setPublishHooksForTests({ beforeStep: async (name) => { if (name === "build") await sleep(1_500); } }); // the publish holds the lock ~1.5 s
    const publishing = publish(s.owner.id, s.storeId);
    await sleep(400);
    const t0 = performance.now();
    await updateProduct(s.owner.id, s.storeId, s.productIds[0]!, { name: "بعد از انتشار" }); // default 5 s timeout
    const waited = performance.now() - t0;
    expect(waited).toBeGreaterThan(700); // it really waited for the publish
    const published = await publishing;
    expect(published.number).toBe(1);
    expect(await productName(s.productIds[0]!)).toBe("بعد از انتشار");
    const version = await prisma.storeVersion.findFirstOrThrow({ where: { storeId: s.storeId } });
    expect(JSON.stringify(version.snapshot)).toContain(before);
    expect(JSON.stringify(version.snapshot)).not.toContain("بعد از انتشار");
  });
});

describe("3-6. the timeout: retryable error, no partial writes, publish unaffected, recovery", () => {
  it("3. a writer that waits longer than the timeout gets DraftBusyError; 4. nothing was written; publishing is unaffected; 5. the next change succeeds once the lock is free", async () => {
    const s = await publishableStore({ products: 1 });
    const name0 = await productName(s.productIds[0]!);
    const rev0 = await draftRevisionOf(s.storeId);
    setDraftLockTimeoutForTests(400);
    setPublishHooksForTests({ beforeStep: async (name) => { if (name === "build") await sleep(2_500); } }); // publish holds the lock ~2.5 s
    const publishing = publish(s.owner.id, s.storeId);
    await sleep(300);

    const t0 = performance.now();
    const e = await raw(updateProduct(s.owner.id, s.storeId, s.productIds[0]!, { name: "نباید ذخیره شود" }));
    const waited = performance.now() - t0;
    expect(e).toBeInstanceOf(DraftBusyError);
    expect((e as DraftBusyError).retryable).toBe(true);
    expect(waited).toBeGreaterThan(300);
    expect(waited).toBeLessThan(1_800); // gave up at the timeout, did not wait for the publish
    // other draft writers get the same typed error
    expect(await raw(createCategory(s.owner.id, s.storeId, { name: "دسته نباید ساخته شود" }))).toBeInstanceOf(DraftBusyError);
    expect(await raw(updateStore(s.owner.id, s.storeId, { name: "نام نباید عوض شود" }))).toBeInstanceOf(DraftBusyError);

    // publishing is not affected by the draft writers giving up
    const published = await publishing;
    expect(published.number).toBe(1);
    expect(published.budgetExceeded).toBe(false);

    // 4. no partial writes
    expect(await productName(s.productIds[0]!)).toBe(name0);
    expect(await prisma.productCategory.count({ where: { storeId: s.storeId } })).toBe(0);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } })).name).toBe("فروشگاه");
    expect(await draftRevisionOf(s.storeId)).toBe(rev0); // the revision was not bumped by the failed attempts

    // 5. the same requests now succeed
    setPublishHooksForTests({});
    const t1 = performance.now();
    await updateProduct(s.owner.id, s.storeId, s.productIds[0]!, { name: "حالا ذخیره می‌شود" });
    await createCategory(s.owner.id, s.storeId, { name: "دسته تازه" });
    await updateStore(s.owner.id, s.storeId, { name: "نام تازه" });
    expect(performance.now() - t1).toBeLessThan(2_000);
    expect(await productName(s.productIds[0]!)).toBe("حالا ذخیره می‌شود");
    expect(await draftRevisionOf(s.storeId)).toBe(rev0 + 3);
  }, 30_000);

  it("a timeout in a LATER lock wait rolls back the writes made earlier in the same mutation", async () => {
    const s = await publishableStore({ products: 1 });
    const rev0 = await draftRevisionOf(s.storeId);
    setDraftLockTimeoutForTests(400);
    // another transaction holds this product's ROW lock (not the store lock)
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${s.productIds[0]!} FOR UPDATE`;
      await held;
    }, { timeout: 30_000 });
    await sleep(150);
    const e = await raw(
      withStoreMutation(s.owner.id, s.storeId, async (ctx) => {
        await ctx.tx.productCategory.create({ data: { storeId: s.storeId, name: "نیمه‌کاره", slug: "half-done" } }); // a write BEFORE the wait
        await ctx.tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${s.productIds[0]!} FOR UPDATE`; // blocks -> 55P03
      }),
    );
    expect(e).toBeInstanceOf(DraftBusyError);
    release();
    await holder;
    expect(await prisma.productCategory.count({ where: { storeId: s.storeId } })).toBe(0); // rolled back
    expect(await draftRevisionOf(s.storeId)).toBe(rev0); // the revision bump was rolled back too
  });

  it("with the real 5 s default, a writer behind a long lock gives up after about 5 s with a retryable error and writes nothing", async () => {
    const s = await publishableStore({ products: 1 });
    const holder = holdStoreLock(s.storeId);
    await sleep(150);
    const t0 = performance.now();
    const e = await raw(updateProduct(s.owner.id, s.storeId, s.productIds[0]!, { name: "نباید ذخیره شود" }));
    const waited = performance.now() - t0;
    expect(e).toBeInstanceOf(DraftBusyError);
    expect(waited).toBeGreaterThan(4_500);
    expect(waited).toBeLessThan(7_500);
    holder.release();
    await holder.done;
    expect(await productName(s.productIds[0]!)).not.toBe("نباید ذخیره شود");
    await updateProduct(s.owner.id, s.storeId, s.productIds[0]!, { name: "بعد از آزاد شدن" });
    expect(await productName(s.productIds[0]!)).toBe("بعد از آزاد شدن");
  }, 30_000);

  it("errors that are not lock timeouts pass through unchanged (a failing mutation is not reported as busy)", async () => {
    const s = await publishableStore({ products: 1 });
    class Boom extends Error {}
    expect(await raw(withStoreMutation(s.owner.id, s.storeId, async () => { throw new Boom("x"); }))).toBeInstanceOf(Boom);
    expect(await raw(withStoreMutation(s.owner.id, "cmnonexistent00000000", async () => 1))).toMatchObject({ name: "NotFoundError" });
  });
});

describe("publishing's own lock behavior is unchanged", () => {
  it("a publish behind a draft writer still gets the retryable PublishBusyError at ITS lock timeout (not the draft one)", async () => {
    const s = await publishableStore({ products: 1 });
    setPublishLimitsForTests({ lockTimeoutMs: 300 });
    const holder = holdStoreLock(s.storeId);
    await sleep(150);
    const e = await raw(publish(s.owner.id, s.storeId));
    expect(e).toMatchObject({ name: "PublishBusyError" });
    expect(e).not.toBeInstanceOf(DraftBusyError);
    holder.release();
    await holder.done;
  });
});
