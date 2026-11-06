import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { revision, snapshotRows, twoTenants, validProduct } from "@/test/catalog-helpers";
import { createCategory } from "@/modules/categories/service";
import { changeProductStatus, createProduct } from "@/modules/products/service";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
const revalidated: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import {
  changeProductStatusAction, createCategoryAction, createProductAction, deleteCategoryAction, deleteProductAction,
  updateCategoryAction, updateProductAction,
} from "./catalog-actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const loginAs = (id: string | null) => authMock.mockResolvedValue(id ? { user: { id } } : null);
const redirectOf = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: Error) => x);
  expect(e, "expected a redirect").toBeTruthy();
  const m = /^NEXT_REDIRECT:(.*)$/.exec(e!.message);
  expect(m, `unexpected error: ${e!.message}`).toBeTruthy();
  return m![1]!;
};

const productForm = (storeId: string, over: Record<string, string> = {}) =>
  fd({ storeId, name: "کالا", slug: "", description: "", price: "1000", stockQuantity: "3", categoryId: "", ...over });

beforeEach(async () => {
  await resetDb();
  authMock.mockReset();
  revalidated.length = 0;
});
afterAll(() => prisma.$disconnect());

async function world() {
  const t = await twoTenants();
  const aCat = (await createCategory(t.a.id, t.a1, { name: "دسته الف" })).id;
  const bCat = (await createCategory(t.b.id, t.b1, { name: "دسته ب" })).id;
  const aProd = await createProduct(t.a.id, t.a1, validProduct({ name: "محصول الف", categoryId: aCat }));
  const bProd = await createProduct(t.b.id, t.b1, validProduct({ name: "محصول ب", categoryId: bCat }));
  return { ...t, aCat, bCat, aProd, bProd };
}

describe("catalog Server Actions: unauthenticated", () => {
  it("every action redirects to /login and changes nothing", async () => {
    const w = await world();
    loginAs(null);
    const before = await snapshotRows(w.b1);
    const calls = [
      createProductAction({}, productForm(w.b1)),
      updateProductAction({}, productForm(w.b1, { productId: w.bProd.id })),
      changeProductStatusAction(fd({ storeId: w.b1, productId: w.bProd.id, status: "ACTIVE" })),
      deleteProductAction(fd({ storeId: w.b1, productId: w.bProd.id, confirmDelete: "yes" })),
      createCategoryAction({}, fd({ storeId: w.b1, name: "x" })),
      updateCategoryAction({}, fd({ storeId: w.b1, categoryId: w.bCat, name: "x" })),
      deleteCategoryAction(fd({ storeId: w.b1, categoryId: w.bCat, moveProducts: "on" })),
    ];
    for (const c of calls) expect(await redirectOf(c)).toBe("/login");
    expect(await snapshotRows(w.b1)).toBe(before);
  });
});

describe("catalog Server Actions: forged requests from User A against User B", () => {
  it("every product action with B's store/product ids ends in a redirect to a 404 URL and B is unchanged", async () => {
    const w = await world();
    loginAs(w.a.id);
    const before = await snapshotRows(w.b1);
    const forged = { ownerId: w.a.id, userId: w.a.id, draftRevision: "999" }; // forged identity/ownership fields must be ignored
    const forgedStatus = { ...forged, status: "ACTIVE" }; // for create/update a forged `status` must also be ignored

    expect(await redirectOf(createProductAction({}, productForm(w.b1, forgedStatus)))).toBe(`/dashboard/stores/${w.b1}`);
    expect(await redirectOf(updateProductAction({}, productForm(w.b1, { productId: w.bProd.id, name: "pwned", ...forgedStatus })))).toBe(`/dashboard/stores/${w.b1}/products/${w.bProd.id}`);
    expect(await redirectOf(changeProductStatusAction(fd({ storeId: w.b1, productId: w.bProd.id, status: "ACTIVE", ...forged })))).toBe(`/dashboard/stores/${w.b1}/products/${w.bProd.id}`);
    expect(await redirectOf(deleteProductAction(fd({ storeId: w.b1, productId: w.bProd.id, confirmDelete: "yes", ...forged })))).toBe(`/dashboard/stores/${w.b1}/products/${w.bProd.id}`);
    expect(await snapshotRows(w.b1)).toBe(before);
  });

  it("B's product id through A's OWN store id is also a 404 redirect and changes nothing", async () => {
    const w = await world();
    loginAs(w.a.id);
    const before = await snapshotRows(w.b1);
    const url = `/dashboard/stores/${w.a1}/products/${w.bProd.id}`;
    expect(await redirectOf(updateProductAction({}, productForm(w.a1, { productId: w.bProd.id, name: "pwned" })))).toBe(url);
    expect(await redirectOf(changeProductStatusAction(fd({ storeId: w.a1, productId: w.bProd.id, status: "ACTIVE" })))).toBe(url);
    expect(await redirectOf(deleteProductAction(fd({ storeId: w.a1, productId: w.bProd.id, confirmDelete: "yes" })))).toBe(url);
    expect(await snapshotRows(w.b1)).toBe(before);
  });

  it("every category action with B's ids ends in a 404 redirect and B is unchanged", async () => {
    const w = await world();
    loginAs(w.a.id);
    const before = await snapshotRows(w.b1);
    expect(await redirectOf(createCategoryAction({}, fd({ storeId: w.b1, name: "pwned" })))).toBe(`/dashboard/stores/${w.b1}/categories`);
    expect(await redirectOf(updateCategoryAction({}, fd({ storeId: w.b1, categoryId: w.bCat, name: "pwned" })))).toBe(`/dashboard/stores/${w.b1}/categories/${w.bCat}`);
    expect(await redirectOf(deleteCategoryAction(fd({ storeId: w.b1, categoryId: w.bCat, moveProducts: "on" })))).toBe(`/dashboard/stores/${w.b1}/categories/${w.bCat}`);
    expect(await snapshotRows(w.b1)).toBe(before);
    expect(await prisma.product.count({ where: { storeId: w.b1, categoryId: w.bCat } })).toBe(1);
  });

  it("a foreign id and a random id give the same outcome shape", async () => {
    const w = await world();
    loginAs(w.a.id);
    const shape = async (storeId: string, productId: string) =>
      (await redirectOf(updateProductAction({}, productForm(storeId, { productId })))).replace(storeId, "<s>").replace(productId, "<p>");
    expect(await shape(w.b1, w.bProd.id)).toBe(await shape("random-store", "random-product"));
  });

  it("assigning B's category (or a missing one) to A's product yields the same field error and creates/changes nothing", async () => {
    const w = await world();
    loginAs(w.a.id);
    const r0 = await revision(w.a1);
    const states = [];
    for (const categoryId of [w.bCat, "missing-category", w.aCat + "-nope"]) {
      states.push(await createProductAction({}, productForm(w.a1, { name: "x", categoryId })));
    }
    const upd = await updateProductAction({}, productForm(w.a1, { productId: w.aProd.id, categoryId: w.bCat }));
    for (const s of [...states, upd]) {
      expect(s.error).toBeTruthy();
      expect(s.fieldErrors?.["categoryId"]).toBeTruthy();
      expect(s.fieldErrors).toEqual(states[0]!.fieldErrors);
    }
    expect(await prisma.product.count({ where: { storeId: w.a1 } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: w.aProd.id } })).categoryId).toBe(w.aCat);
    expect(await revision(w.a1)).toBe(r0);
  });
});

describe("catalog Server Actions: owner flows", () => {
  it("creates a DRAFT product (Persian digits and separators in price), then lands on the list with a notice", async () => {
    const w = await world();
    loginAs(w.a.id);
    const url = await redirectOf(createProductAction({}, productForm(w.a1, { name: "چاي سبز", price: "۱۲٬۵۰۰", stockQuantity: "٠" })));
    expect(url).toBe(`/dashboard/stores/${w.a1}/products?notice=product-created`);
    const p = await prisma.product.findFirstOrThrow({ where: { storeId: w.a1, name: "چای سبز" } });
    expect(p).toMatchObject({ price: 12500, stockQuantity: 0, status: "DRAFT" });
  });

  it("returns field errors for bad input without creating anything or bumping the revision", async () => {
    const w = await world();
    loginAs(w.a.id);
    const r0 = await revision(w.a1);
    const s = await createProductAction({}, productForm(w.a1, { name: "", price: "-5", stockQuantity: "2000000" }));
    expect(s.error).toBeTruthy();
    expect(Object.keys(s.fieldErrors ?? {}).sort()).toEqual(["name", "price", "stockQuantity"]);
    expect(await revision(w.a1)).toBe(r0);
  });

  it("update saves and reports success; a duplicate slug is a field error", async () => {
    const w = await world();
    loginAs(w.a.id);
    const other = await createProduct(w.a.id, w.a1, validProduct({ name: "دیگر", slug: "other-slug" }));
    const ok = await updateProductAction({}, productForm(w.a1, { productId: w.aProd.id, name: "نام جدید", price: "2000", slug: w.aProd.slug }));
    expect(ok.success).toBeTruthy();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: w.aProd.id } })).name).toBe("نام جدید");
    const dup = await updateProductAction({}, productForm(w.a1, { productId: w.aProd.id, slug: "other-slug" }));
    expect(dup.fieldErrors?.["slug"]).toBeTruthy();
    void other;
  });

  it("status buttons: allowed transitions apply with a notice; invalid ones redirect with an error notice and change nothing", async () => {
    const w = await world();
    loginAs(w.a.id);
    const base = `/dashboard/stores/${w.a1}/products`;
    const go = (status: string, extra: Record<string, string> = {}) =>
      redirectOf(changeProductStatusAction(fd({ storeId: w.a1, productId: w.aProd.id, status, ...extra })));
    expect(await go("ACTIVE")).toBe(`${base}?notice=status-activated`);
    expect(await go("ACTIVE")).toBe(`${base}?notice=status-invalid`); // already active
    expect(await go("ARCHIVED")).toBe(`${base}?notice=status-archived`);
    expect(await go("ACTIVE")).toBe(`${base}?notice=status-invalid`); // ARCHIVED -> ACTIVE is not allowed
    expect((await prisma.product.findUniqueOrThrow({ where: { id: w.aProd.id } })).status).toBe("ARCHIVED");
    expect(await go("DRAFT")).toBe(`${base}?notice=status-draft`);
    expect(await go("PUBLISHED")).toBe(`${base}?notice=status-invalid`); // not a status at all
  });

  it("the list's search/filter/page context survives a status change redirect", async () => {
    const w = await world();
    loginAs(w.a.id);
    const url = await redirectOf(changeProductStatusAction(fd({ storeId: w.a1, productId: w.aProd.id, status: "ACTIVE", q: "الف", category: w.aCat, filterStatus: "DRAFT", page: "2", pageSize: "10" })));
    const u = new URL(url, "http://x");
    expect(u.pathname).toBe(`/dashboard/stores/${w.a1}/products`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "الف", category: w.aCat, status: "DRAFT", page: "2", pageSize: "10", notice: "status-activated" });
  });

  it("stock 0 does not affect status in any action", async () => {
    const w = await world();
    loginAs(w.a.id);
    await redirectOf(changeProductStatusAction(fd({ storeId: w.a1, productId: w.aProd.id, status: "ACTIVE" })));
    await updateProductAction({}, productForm(w.a1, { productId: w.aProd.id, stockQuantity: "0", slug: w.aProd.slug, name: "محصول الف", price: "12500", categoryId: w.aCat }));
    expect(await prisma.product.findUniqueOrThrow({ where: { id: w.aProd.id } })).toMatchObject({ status: "ACTIVE", stockQuantity: 0 });
  });

  it("delete needs explicit confirmation", async () => {
    const w = await world();
    loginAs(w.a.id);
    const base = `/dashboard/stores/${w.a1}/products`;
    expect(await redirectOf(deleteProductAction(fd({ storeId: w.a1, productId: w.aProd.id })))).toBe(`${base}?notice=delete-unconfirmed`);
    expect(await redirectOf(deleteProductAction(fd({ storeId: w.a1, productId: w.aProd.id, confirmDelete: "no" })))).toBe(`${base}?notice=delete-unconfirmed`);
    expect(await prisma.product.count({ where: { id: w.aProd.id } })).toBe(1);
    expect(await redirectOf(deleteProductAction(fd({ storeId: w.a1, productId: w.aProd.id, confirmDelete: "yes" })))).toBe(`${base}?notice=product-deleted`);
    expect(await prisma.product.count({ where: { id: w.aProd.id } })).toBe(0);
  });

  it("category delete: refused with a notice while it has products; with explicit confirmation products are moved, never deleted", async () => {
    const w = await world();
    loginAs(w.a.id);
    const base = `/dashboard/stores/${w.a1}/categories`;
    expect(await redirectOf(deleteCategoryAction(fd({ storeId: w.a1, categoryId: w.aCat })))).toBe(`${base}?notice=category-not-empty`);
    expect(await prisma.productCategory.count({ where: { id: w.aCat } })).toBe(1);
    expect(await redirectOf(deleteCategoryAction(fd({ storeId: w.a1, categoryId: w.aCat, moveProducts: "on" })))).toBe(`${base}?notice=category-deleted-moved`);
    expect(await prisma.productCategory.count({ where: { id: w.aCat } })).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: w.aProd.id } })).categoryId).toBeNull();
    const empty = (await createCategory(w.a.id, w.a1, { name: "خالی" })).id;
    expect(await redirectOf(deleteCategoryAction(fd({ storeId: w.a1, categoryId: empty })))).toBe(`${base}?notice=category-deleted`);
  });

  it("category create/rename and product update revalidate the pages that show their data", async () => {
    const w = await world();
    loginAs(w.a.id);
    await createCategoryAction({}, fd({ storeId: w.a1, name: "تازه" }));
    expect(revalidated).toContain(`/dashboard/stores/${w.a1}/categories`);
    await updateProductAction({}, productForm(w.a1, { productId: w.aProd.id, name: "نام تازه", slug: w.aProd.slug, price: "5", categoryId: w.aCat }));
    expect(revalidated).toContain(`/dashboard/stores/${w.a1}/products`);
    // failed mutations revalidate nothing
    revalidated.length = 0;
    await createCategoryAction({}, fd({ storeId: w.a1, name: "" }));
    expect(revalidated).toEqual([]);
  });

  it("category create/rename report success or field errors; duplicates by letter variant are rejected", async () => {
    const w = await world();
    loginAs(w.a.id);
    expect((await createCategoryAction({}, fd({ storeId: w.a1, name: "علي" }))).success).toBeTruthy();
    const dup = await createCategoryAction({}, fd({ storeId: w.a1, name: "علی" }));
    expect(dup.fieldErrors?.["name"]).toBeTruthy();
    const c = await prisma.productCategory.findFirstOrThrow({ where: { storeId: w.a1, name: "علی" } });
    expect((await updateCategoryAction({}, fd({ storeId: w.a1, categoryId: c.id, name: "كتاب" }))).success).toBeTruthy();
    expect((await prisma.productCategory.findUniqueOrThrow({ where: { id: c.id } })).name).toBe("کتاب");
  });

  it("reports the product and category limits as form errors", async () => {
    const w = await world();
    loginAs(w.a.id);
    await prisma.product.createMany({ data: Array.from({ length: 499 }, (_, i) => ({ storeId: w.a1, name: `p${i}`, slug: `lim${i}`, price: 1, searchKey: `p${i}` })) });
    const s = await createProductAction({}, productForm(w.a1, { name: "پانصد و یکم" }));
    expect(s.error).toContain("۵۰۰");
    await prisma.productCategory.createMany({ data: Array.from({ length: 49 }, (_, i) => ({ storeId: w.a1, name: `lc${i}`, slug: `lc${i}` })) });
    expect((await createCategoryAction({}, fd({ storeId: w.a1, name: "x" }))).error).toContain("۵۰");
  });

  it("changeProductStatus on a product the service already archived behaves like the service", async () => {
    const w = await world();
    loginAs(w.a.id);
    await changeProductStatus(w.a.id, w.a1, w.aProd.id, "ARCHIVED");
    expect(await redirectOf(changeProductStatusAction(fd({ storeId: w.a1, productId: w.aProd.id, status: "ACTIVE", returnTo: "edit" })))).toBe(
      `/dashboard/stores/${w.a1}/products/${w.aProd.id}?notice=status-invalid`,
    );
  });
});
