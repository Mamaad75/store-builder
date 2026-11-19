import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { revision, snapshotRows, twoTenants, validProduct } from "@/test/catalog-helpers";
import { CatalogLimitError, CategoryNotEmptyError, NotFoundError, ValidationError } from "@/modules/stores/errors";
import { createProduct } from "@/modules/products/service";
import { CategoryRepository } from "./repository";
import { createCategory, deleteCategory, listCategories, updateCategory } from "./service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("categories: basics", () => {
  it("creates, lists with product counts, renames; slug is generated once and survives renames", async () => {
    const { a, a1 } = await twoTenants();
    const r0 = await revision(a1);
    const { id } = await createCategory(a.id, a1, { name: "  نوشیدنی  گرم " });
    expect(await revision(a1)).toBe(r0 + 1);
    let list = await listCategories(a.id, a1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "نوشیدنی گرم", slug: "نوشیدنی-گرم", _count: { products: 0 } });
    await createProduct(a.id, a1, validProduct({ categoryId: id }));
    await updateCategory(a.id, a1, id, { name: "نوشیدنی‌ها" });
    list = await listCategories(a.id, a1);
    expect(list[0]).toMatchObject({ name: "نوشیدنی‌ها", slug: "نوشیدنی-گرم", _count: { products: 1 } });
  });

  it("normalises Persian letters and rejects duplicates across letter, digit and case variants", async () => {
    const { a, a1 } = await twoTenants();
    await createCategory(a.id, a1, { name: "علی ۱۲" });
    for (const dup of ["علي 12", "عَلی ١٢", "علی ۱۲"]) {
      await expect(createCategory(a.id, a1, { name: dup })).rejects.toBeInstanceOf(ValidationError);
    }
    await createCategory(a.id, a1, { name: "Tea" });
    await expect(createCategory(a.id, a1, { name: "tea" })).rejects.toBeInstanceOf(ValidationError);
    const stored = await prisma.productCategory.findMany({ where: { storeId: a1 } });
    expect(stored.map((c) => c.name).sort()).toEqual(["Tea", "علی ۱۲"].sort());
    expect(stored.some((c) => /[يك]/.test(c.name))).toBe(false);
  });

  it("same name is allowed in different stores; generated slug is unique within a store", async () => {
    const { a, a1, a2 } = await twoTenants();
    await createCategory(a.id, a1, { name: "چای" });
    await createCategory(a.id, a2, { name: "چای" });
    await expect(createCategory(a.id, a1, { name: "چای" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects invalid input and mass-assignment without changing anything", async () => {
    const { a, a1 } = await twoTenants();
    const before = await snapshotRows(a1);
    for (const bad of [{ name: "" }, { name: "x".repeat(61) }, {}, { name: "ok", slug: "evil" }, { name: "ok", storeId: "x" }, { name: 5 }]) {
      await expect(createCategory(a.id, a1, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await snapshotRows(a1)).toBe(before);
  });

  it("enforces the 50-category limit", async () => {
    const { a, a1 } = await twoTenants();
    for (let i = 0; i < 50; i++) await createCategory(a.id, a1, { name: `cat ${i}` });
    await expect(createCategory(a.id, a1, { name: "one too many" })).rejects.toBeInstanceOf(CatalogLimitError);
    expect(await prisma.productCategory.count({ where: { storeId: a1 } })).toBe(50);
  });

  it("a no-op rename does not write or bump draftRevision", async () => {
    const { a, a1 } = await twoTenants();
    const { id } = await createCategory(a.id, a1, { name: "چای" });
    const r = await revision(a1);
    await updateCategory(a.id, a1, id, { name: "چاي" }); // normalises to the same name
    expect(await revision(a1)).toBe(r);
  });
});

describe("categories: tenant isolation", () => {
  it("A cannot list, rename or delete B's categories; foreign and missing ids are indistinguishable", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    const { id: bCat } = await createCategory(b.id, b1, { name: "محرمانه" });
    const before = await snapshotRows(b1);

    const list = await listCategories(a.id, b1).catch((e) => e);
    expect(list).toBeInstanceOf(NotFoundError); // 404, not an empty list
    const rename = await updateCategory(a.id, b1, bCat, { name: "pwned" }).catch((e) => e);
    const renameMissing = await updateCategory(a.id, a1, "nope", { name: "pwned" }).catch((e) => e);
    const del = await deleteCategory(a.id, b1, bCat, { moveProducts: true }).catch((e) => e);
    const delMissing = await deleteCategory(a.id, a1, "nope", { moveProducts: true }).catch((e) => e);
    for (const e of [rename, renameMissing, del, delMissing]) expect(e).toBeInstanceOf(NotFoundError);
    expect(rename.message).toBe(renameMissing.message);
    expect(await snapshotRows(b1)).toBe(before);
  });

  it("a category id from another store of the SAME owner is not reachable through this store", async () => {
    const { a, a1, a2 } = await twoTenants();
    const { id } = await createCategory(a.id, a2, { name: "فقط دومی" });
    await expect(updateCategory(a.id, a1, id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCategory(a.id, a1, id, { moveProducts: true })).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.productCategory.count({ where: { id } })).toBe(1);
  });
});

describe("categories: the repository itself is owner-bound (not only the service in front of it)", () => {
  it("reads through CategoryRepository never cross tenants, even when called directly with a foreign store/category id", async () => {
    const { a, b, a1, a2, b1 } = await twoTenants();
    const bCat = (await createCategory(b.id, b1, { name: "محرمانه" })).id;
    const aCat2 = (await createCategory(a.id, a2, { name: "دسته دوم الف" })).id;
    const repo = new CategoryRepository(a.id);
    expect(await repo.list(b1)).toEqual([]);
    expect(await repo.find(b1, bCat)).toBeNull();
    expect(await repo.find(a1, bCat)).toBeNull();
    expect(await repo.find(a1, aCat2)).toBeNull(); // same owner, different store
    expect((await repo.list(a2)).map((c) => c.id)).toEqual([aCat2]);
    expect(() => new CategoryRepository("")).toThrow();
  });
});

describe("categories: deleting a category that contains products", () => {
  async function seed() {
    const t = await twoTenants();
    const { id: cat } = await createCategory(t.a.id, t.a1, { name: "چای" });
    const p1 = await createProduct(t.a.id, t.a1, validProduct({ categoryId: cat }));
    const p2 = await createProduct(t.a.id, t.a1, validProduct({ name: "قهوه", categoryId: cat }));
    const other = await createProduct(t.a.id, t.a1, validProduct({ name: "بدون دسته" }));
    return { ...t, cat, p1, p2, other };
  }

  it("is refused by default (with the product count) and nothing changes, not even draftRevision", async () => {
    const { a, a1, cat } = await seed();
    const before = await snapshotRows(a1);
    const err = await deleteCategory(a.id, a1, cat).catch((e) => e);
    expect(err).toBeInstanceOf(CategoryNotEmptyError);
    expect(err.productCount).toBe(2);
    const err2 = await deleteCategory(a.id, a1, cat, { moveProducts: false }).catch((e) => e);
    expect(err2).toBeInstanceOf(CategoryNotEmptyError);
    expect(await snapshotRows(a1)).toBe(before);
  });

  it("with explicit confirmation moves the products to uncategorised and deletes the category; products are never deleted", async () => {
    const { a, a1, a2, b1, cat, p1, p2, other } = await seed();
    const rev = await revision(a1);
    const res = await deleteCategory(a.id, a1, cat, { moveProducts: true });
    expect(res.movedProducts).toBe(2);
    expect(await prisma.productCategory.count({ where: { id: cat } })).toBe(0);
    const rows = await prisma.product.findMany({ where: { storeId: a1 }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.id)).toEqual([p1.id, p2.id, other.id]);
    expect(rows.every((r) => r.categoryId === null)).toBe(true);
    expect(await revision(a1)).toBe(rev + 1);
    expect(await prisma.product.count({ where: { storeId: { in: [a2, b1] } } })).toBe(0);
  });

  it("deleting an empty category needs no confirmation", async () => {
    const { a, a1 } = await twoTenants();
    const { id } = await createCategory(a.id, a1, { name: "خالی" });
    expect(await deleteCategory(a.id, a1, id)).toEqual({ movedProducts: 0 });
  });

  it("rejects malformed options", async () => {
    const { a, a1, cat } = await seed();
    await expect(deleteCategory(a.id, a1, cat, { moveProducts: "yes" })).rejects.toBeInstanceOf(ValidationError);
    await expect(deleteCategory(a.id, a1, cat, { moveProducts: true, evil: 1 })).rejects.toBeInstanceOf(ValidationError);
  });
});
