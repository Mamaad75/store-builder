import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSearchKey } from "@/lib/text";
import { updateProduct } from "@/modules/products/service";
import { updateStore } from "@/modules/stores/service";
import { createCategory } from "@/modules/categories/service";
import { prisma, resetDb } from "@/test/db-helpers";
import { draftRevisionOf, publishableStore } from "@/test/publish-helpers";
import { DEFAULT_PUBLISH_LIMITS, setPublishHooksForTests, setPublishLimitsForTests } from "./constants";
import { publishStore } from "./service";

beforeEach(resetDb);
afterEach(() => {
  setPublishLimitsForTests({});
  setPublishHooksForTests({});
});
afterAll(() => prisma.$disconnect());

const cjk = (n: number, seed: number) => String.fromCodePoint(0x4e00 + (seed % 5000)).repeat(n);
const pid = (i: number) => `p${i}`.padEnd(25, "y");

/** 500 maximum products (120-unit name, 80-unit slug, 5,000-unit description, 30 maximum specs, all 3-byte characters), 49 categories (one slot left for the concurrent writer), 3 full pages. */
async function seedWorstCase(storeId: string) {
  const cats = Array.from({ length: 49 }, (_, i) => ({ id: `cat${i}`.padEnd(25, "x"), storeId, name: cjk(60, i), slug: cjk(80, i), position: i }));
  await prisma.productCategory.createMany({ data: cats });
  const specs = (i: number) => Array.from({ length: 30 }, (_, r) => ({ label: cjk(40, r + i), value: cjk(120, r + i) }));
  for (let b = 0; b < 10; b++) {
    await prisma.product.createMany({
      data: Array.from({ length: 50 }, (_, k) => {
        const i = b * 50 + k;
        const name = cjk(120, i);
        return { id: pid(i), storeId, categoryId: cats[i % 49]!.id, name, slug: cjk(80, i + 7000), description: cjk(5000, i), price: 1_000_000, stockQuantity: 5, searchKey: makeSearchKey(name), status: "ACTIVE" as const, specs: specs(i), position: i };
      }),
    });
  }
  const sec = (i: number) => ({ id: `s${i.toString(16).padStart(12, "0")}`, type: "richText", props: { title: cjk(120, i), body: cjk(5000, i) } });
  for (const [type, base] of [["HOME", 0], ["ABOUT", 200], ["CONTACT", 400]] as const) {
    await prisma.page.updateMany({ where: { storeId, type }, data: { sections: Array.from({ length: 20 }, (_, i) => sec(base + i)) as never } });
  }
}

describe("worst-case publish: the lock-hold budget, INCLUDING the commit, with concurrent draft writers", () => {
  it("500 maximum products + full pages publish within 10 s of lock hold; concurrent draft writes wait, then succeed, within the same budget", async () => {
    const { owner, storeId } = await publishableStore({ products: 0 });
    await seedWorstCase(storeId);
    const rev = await draftRevisionOf(storeId);

    // Start the concurrent writers the moment the publish holds the lock.
    let writers: Promise<number>[] = [];
    let lockedAt = 0;
    setPublishHooksForTests({
      beforeStep: (name) => {
        if (name !== "checks" || writers.length) return;
        lockedAt = performance.now();
        const timed = (p: Promise<unknown>) => p.then(() => performance.now() - lockedAt);
        writers = [
          timed(updateProduct(owner.id, storeId, pid(0), { name: "نام نو ۰" })),
          timed(updateProduct(owner.id, storeId, pid(1), { price: 12345 })),
          timed(updateStore(owner.id, storeId, { name: "فروشگاه تازه" })),
          timed(createCategory(owner.id, storeId, { name: "دستهٔ همزمان" })),
        ];
      },
    });

    const tStart = performance.now();
    const r = await publishStore(owner.id, storeId, { expectedDraftRevision: rev });
    const total = performance.now() - tStart;
    const waits = await Promise.all(writers);

    const stats = { bytes: r.snapshotBytes, MiB: +(r.snapshotBytes / 1048576).toFixed(2), lockHeldMsIncludingCommit: Math.round(r.lockHeldMs), buildMs: Math.round(r.buildMs), totalPublishMs: Math.round(total), writerWaitsMs: waits.map(Math.round) };
    process.stdout.write(`PUBLISH_WORST_CASE ${JSON.stringify(stats)}\n`);

    expect(r.snapshotBytes).toBeLessThanOrEqual(DEFAULT_PUBLISH_LIMITS.maxSnapshotBytes);
    expect(r.snapshotBytes).toBeGreaterThan(15_000_000); // it really is the worst case (about 16 MB)
    expect(r.lockHeldMs, "lock hold including COMMIT").toBeLessThanOrEqual(DEFAULT_PUBLISH_LIMITS.lockBudgetMs);
    expect(r.budgetExceeded).toBe(false);
    for (const w of waits) expect(w, "concurrent draft writer").toBeLessThanOrEqual(DEFAULT_PUBLISH_LIMITS.lockBudgetMs);
    // the writers applied AFTER the publish: the snapshot has none of their changes, the draft has all of them
    const v = await prisma.storeVersion.findUniqueOrThrow({ where: { id: r.versionId } });
    expect(JSON.stringify(v.snapshot)).not.toContain("نام نو ۰");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: pid(0) } })).name).toBe("نام نو ۰");
    expect(await draftRevisionOf(storeId)).toBe(rev + 4); // four draft writes bumped it; the publish itself did not
    expect(await prisma.storeVersionProduct.count({ where: { versionId: r.versionId } })).toBe(500);
    expect(await prisma.publishedSlug.count({ where: { storeId } })).toBe(500);
  }, 180_000);
});
