import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createCategory } from "@/modules/categories/service";
import { getNotice } from "@/modules/products/notices";
import { createProduct } from "@/modules/products/service";
import { DRAFT_BUSY_MESSAGE } from "@/modules/stores/errors";
import { setDraftLockTimeoutForTests } from "@/modules/stores/mutation";
import { revision, snapshotRows, twoTenants, validProduct } from "@/test/catalog-helpers";
import { prisma, resetDb } from "@/test/db-helpers";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { deleteStoreAction, switchThemeAction, updateBusinessCategoryAction, updateStoreAction } from "./actions";
import { changeProductStatusAction, createCategoryAction, deleteCategoryAction, deleteProductAction, updateCategoryAction, updateProductAction } from "./catalog-actions";
import { removeStoreLogoAction } from "./media-actions";
import { pageEditAction, updateAppearanceAction } from "./pages-actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const redirectOf = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: Error) => x);
  expect(e, "expected a redirect").toBeTruthy();
  const m = /^NEXT_REDIRECT:(.*)$/.exec(e!.message);
  expect(m, `unexpected error: ${e!.message}`).toBeTruthy();
  return m![1]!;
};

beforeEach(async () => {
  await resetDb();
  authMock.mockReset();
  setDraftLockTimeoutForTests(300);
});
afterEach(() => setDraftLockTimeoutForTests());
afterAll(() => prisma.$disconnect());

/** Holds the store lock (as a publish would) while `fn` runs. */
async function whileStoreLocked<T>(storeId: string, fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const holder = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
    await held;
  }, { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 100));
  try {
    return await fn();
  } finally {
    release();
    await holder;
  }
}

async function world() {
  const t = await twoTenants();
  const cat = (await createCategory(t.a.id, t.a1, { name: "دسته الف" })).id;
  const prod = await createProduct(t.a.id, t.a1, validProduct({ name: "محصول الف", categoryId: cat }));
  authMock.mockResolvedValue({ user: { id: t.a.id } });
  return { ...t, cat, prod };
}

describe("dashboard actions while the store is busy (a publish holds the lock past the timeout)", () => {
  it("the notice code exists and is an error with the Persian message", () => {
    expect(getNotice("busy")).toMatchObject({ severity: "error" });
    expect(getNotice("busy")!.text).toMatch(/دوباره تلاش کنید/);
  });

  it("form-state actions return the Persian retry message and change NOTHING", async () => {
    const w = await world();
    const before = await snapshotRows(w.a1);
    const rev = await revision(w.a1);
    await whileStoreLocked(w.a1, async () => {
      expect(await createCategoryAction({}, fd({ storeId: w.a1, name: "دسته نو" }))).toEqual({ error: DRAFT_BUSY_MESSAGE });
      expect(await updateCategoryAction({}, fd({ storeId: w.a1, categoryId: w.cat, name: "نام تازه" }))).toEqual({ error: DRAFT_BUSY_MESSAGE });
      expect(
        await updateProductAction({}, fd({ storeId: w.a1, productId: w.prod.id, name: "تغییر", slug: "", description: "", price: "1000", stockQuantity: "3", categoryId: "" })),
      ).toEqual({ error: DRAFT_BUSY_MESSAGE });
      expect(await updateStoreAction({}, fd({ storeId: w.a1, name: "نام دیگر", primaryColor: "#112233" }))).toEqual({ error: DRAFT_BUSY_MESSAGE });
      expect(await removeStoreLogoAction({}, fd({ storeId: w.a1 }))).toEqual({ error: DRAFT_BUSY_MESSAGE });
      expect(await pageEditAction({}, fd({ storeId: w.a1, pageType: "ABOUT", expectedRevision: "1", intent: "visibility", visible: "false" }))).toMatchObject({ error: DRAFT_BUSY_MESSAGE });
      expect(await updateAppearanceAction({}, fd({ storeId: w.a1, primaryColor: "#112233", sizeScale: "normal", headingWeight: "700", bodyWeight: "400" }))).toMatchObject({ error: DRAFT_BUSY_MESSAGE });
      expect(await switchThemeAction({}, fd({ storeId: w.a1, targetKey: "coffee", expectedDraftRevision: String(rev) }))).toEqual({ error: DRAFT_BUSY_MESSAGE });
    });
    expect(await snapshotRows(w.a1)).toBe(before); // not a single column changed
    expect(await revision(w.a1)).toBe(rev);
  }, 30_000);

  it("redirect-style actions send the owner back with the 'busy' notice and change nothing", async () => {
    const w = await world();
    const before = await snapshotRows(w.a1);
    await whileStoreLocked(w.a1, async () => {
      const status = await redirectOf(changeProductStatusAction(fd({ storeId: w.a1, productId: w.prod.id, status: "ACTIVE" })));
      expect(status).toContain("notice=busy");
      const del = await redirectOf(deleteProductAction(fd({ storeId: w.a1, productId: w.prod.id, confirmDelete: "on" })));
      expect(del).toContain("notice=busy");
      const delCat = await redirectOf(deleteCategoryAction(fd({ storeId: w.a1, categoryId: w.cat, moveProducts: "on" })));
      expect(delCat).toContain("notice=busy");
    });
    expect(await snapshotRows(w.a1)).toBe(before);
  }, 30_000);

  it("after the lock is released the same actions work (the error is retryable)", async () => {
    const w = await world();
    await whileStoreLocked(w.a1, async () => {
      expect(await createCategoryAction({}, fd({ storeId: w.a1, name: "دسته نو" }))).toEqual({ error: DRAFT_BUSY_MESSAGE });
    });
    expect(await createCategoryAction({}, fd({ storeId: w.a1, name: "دسته نو" }))).toEqual({ success: "دسته‌بندی ساخته شد." });
    expect(await updateStoreAction({}, fd({ storeId: w.a1, name: "نام دیگر", primaryColor: "#112233" }))).toEqual({ success: "تغییرات ذخیره شد." });
    expect(await prisma.productCategory.count({ where: { storeId: w.a1 } })).toBe(2);
  });
});

describe("business-category and store-deletion actions while the store is busy", () => {
  it("both return the Persian retry message, change nothing, and work once the lock is free", async () => {
    const w = await world();
    const before = await snapshotRows(w.a1);
    const current = (await prisma.store.findUniqueOrThrow({ where: { id: w.a1 } })).businessCategory;
    const target = current === "fashion" ? "general" : "fashion";
    await whileStoreLocked(w.a1, async () => {
      expect(await updateBusinessCategoryAction({}, fd({ storeId: w.a1, businessCategory: target, expected: current }))).toEqual({ error: DRAFT_BUSY_MESSAGE });
      expect(await deleteStoreAction({}, fd({ storeId: w.a1, confirmName: "A one" }))).toEqual({ error: DRAFT_BUSY_MESSAGE });
    });
    expect(await snapshotRows(w.a1)).toBe(before); // nothing changed, the store still exists
    // retry succeeds
    expect(await updateBusinessCategoryAction({}, fd({ storeId: w.a1, businessCategory: target, expected: current }))).toEqual({ success: "دسته‌بندی ذخیره شد." });
    await redirectOf(deleteStoreAction({}, fd({ storeId: w.a1, confirmName: "A one" }))); // success redirects to the dashboard
    expect(await prisma.store.count({ where: { id: w.a1 } })).toBe(0);
  }, 30_000);
});

