import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { revision, twoTenants, validProduct } from "@/test/catalog-helpers";
import { createCategory, deleteCategory } from "@/modules/categories/service";
import { CatalogLimitError, CategoryNotEmptyError, ValidationError } from "@/modules/stores/errors";
import { changeProductStatus, createProduct, deleteProduct, updateProduct } from "./service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
const ok = <T>(rs: PromiseSettledResult<T>[]) => rs.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled");
const failed = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);

describe("concurrency: slugs", () => {
  it("20 simultaneous creates with the same name all succeed with distinct generated slugs", async () => {
    const { a, a1 } = await twoTenants();
    const r0 = await revision(a1);
    const rs = await settle(Array.from({ length: 20 }, () => createProduct(a.id, a1, validProduct({ name: "چای سبز" }))));
    expect(failed(rs)).toEqual([]);
    const slugs = ok(rs).map((r) => r.value.slug);
    expect(new Set(slugs).size).toBe(20);
    expect(slugs).toContain("چای-سبز");
    expect(slugs).toContain("چای-سبز-20");
    expect(await prisma.product.count({ where: { storeId: a1 } })).toBe(20);
    expect(await revision(a1)).toBe(r0 + 20);
  });

  it("20 simultaneous creates with the same EXPLICIT slug: exactly one wins, the rest are clean validation errors", async () => {
    const { a, a1 } = await twoTenants();
    const r0 = await revision(a1);
    const rs = await settle(Array.from({ length: 20 }, (_, i) => createProduct(a.id, a1, validProduct({ name: `n${i}`, slug: "same-slug" }))));
    expect(ok(rs)).toHaveLength(1);
    const errors = failed(rs);
    expect(errors).toHaveLength(19);
    expect(errors.every((e) => e instanceof ValidationError && e.fieldErrors["slug"])).toBe(true);
    expect(await prisma.product.count({ where: { storeId: a1, slug: "same-slug" } })).toBe(1);
    expect(await revision(a1)).toBe(r0 + 1); // failed attempts rolled back, not counted
  });

  it("the same slug may be created concurrently in different stores", async () => {
    const { a, b, a1, a2, b1 } = await twoTenants();
    const rs = await settle([
      createProduct(a.id, a1, validProduct({ slug: "shared" })),
      createProduct(a.id, a2, validProduct({ slug: "shared" })),
      createProduct(b.id, b1, validProduct({ slug: "shared" })),
    ]);
    expect(ok(rs)).toHaveLength(3);
  });

  it("two products racing to rename onto the same slug: one wins", async () => {
    const { a, a1 } = await twoTenants();
    const p1 = await createProduct(a.id, a1, validProduct({ name: "one" }));
    const p2 = await createProduct(a.id, a1, validProduct({ name: "two" }));
    const rs = await settle([updateProduct(a.id, a1, p1.id, { slug: "target" }), updateProduct(a.id, a1, p2.id, { slug: "target" })]);
    expect(ok(rs)).toHaveLength(1);
    expect(failed(rs)[0]).toBeInstanceOf(ValidationError);
    expect(await prisma.product.count({ where: { storeId: a1, slug: "target" } })).toBe(1);
  });
});

describe("concurrency: limits", () => {
  it("product limit: with 490 existing, 20 simultaneous creates yield exactly 10 successes and 10 limit errors", async () => {
    const { a, a1 } = await twoTenants();
    await prisma.product.createMany({ data: Array.from({ length: 490 }, (_, i) => ({ storeId: a1, name: `p${i}`, slug: `p${i}`, price: 1, searchKey: `p${i}` })) });
    const rs = await settle(Array.from({ length: 20 }, (_, i) => createProduct(a.id, a1, validProduct({ name: `new ${i}` }))));
    expect(ok(rs)).toHaveLength(10);
    expect(failed(rs).every((e) => e instanceof CatalogLimitError)).toBe(true);
    expect(await prisma.product.count({ where: { storeId: a1 } })).toBe(500);
  });

  it("category limit: with 45 existing, 10 simultaneous creates yield exactly 5 successes", async () => {
    const { a, a1 } = await twoTenants();
    await prisma.productCategory.createMany({ data: Array.from({ length: 45 }, (_, i) => ({ storeId: a1, name: `c${i}`, slug: `c${i}` })) });
    const rs = await settle(Array.from({ length: 10 }, (_, i) => createCategory(a.id, a1, { name: `new ${i}` })));
    expect(ok(rs)).toHaveLength(5);
    expect(failed(rs).every((e) => e instanceof CatalogLimitError)).toBe(true);
    expect(await prisma.productCategory.count({ where: { storeId: a1 } })).toBe(50);
  });

  it("limits are per store: another store of the same owner is unaffected", async () => {
    const { a, a1, a2 } = await twoTenants();
    await prisma.product.createMany({ data: Array.from({ length: 500 }, (_, i) => ({ storeId: a1, name: `p${i}`, slug: `p${i}`, price: 1, searchKey: `p${i}` })) });
    await expect(createProduct(a.id, a1, validProduct())).rejects.toBeInstanceOf(CatalogLimitError);
    await createProduct(a.id, a2, validProduct());
  });
});

describe("concurrency: category names", () => {
  it("10 simultaneous creates of the same category name (including letter variants): exactly one wins", async () => {
    const { a, a1 } = await twoTenants();
    const names = ["چای", "چاي", "چای", "چاي", "چای", "چای", "چاي", "چای", "چای", "چاي"];
    const rs = await settle(names.map((name) => createCategory(a.id, a1, { name })));
    expect(ok(rs)).toHaveLength(1);
    expect(failed(rs).every((e) => e instanceof ValidationError && e.fieldErrors["name"])).toBe(true);
    expect(await prisma.productCategory.count({ where: { storeId: a1 } })).toBe(1);
  });
});

describe("concurrency: deleting a category while products are being created in it", () => {
  it("moveProducts=true: no dangling reference, no lost product; outcomes are only 'moved' or 'rejected'", async () => {
    const { a, a1 } = await twoTenants();
    for (let i = 0; i < 12; i++) {
      const { id: cat } = await createCategory(a.id, a1, { name: `cat ${i}` });
      const [create, del] = await Promise.allSettled([
        createProduct(a.id, a1, validProduct({ name: `p ${i}`, categoryId: cat })),
        deleteCategory(a.id, a1, cat, { moveProducts: true }),
      ]);
      expect(del!.status, `iteration ${i}`).toBe("fulfilled"); // delete always succeeds with moveProducts
      expect(await prisma.productCategory.count({ where: { id: cat } })).toBe(0);
      if (create!.status === "fulfilled") {
        // created first, then moved to uncategorised
        expect((await prisma.product.findUniqueOrThrow({ where: { id: create!.value.id } })).categoryId).toBeNull();
      } else {
        expect(create!.reason).toBeInstanceOf(ValidationError); // category was already gone
        expect(await prisma.product.count({ where: { name: `p ${i}` } })).toBe(0);
      }
    }
    expect(await prisma.product.count({ where: { storeId: a1, categoryId: { not: null } } })).toBe(0);
  });

  it("moveProducts=false: either the product is created and the delete is refused, or the delete wins and the create is rejected", async () => {
    const { a, a1 } = await twoTenants();
    for (let i = 0; i < 12; i++) {
      const { id: cat } = await createCategory(a.id, a1, { name: `cat ${i}` });
      const [create, del] = await Promise.allSettled([
        createProduct(a.id, a1, validProduct({ name: `p ${i}`, categoryId: cat })),
        deleteCategory(a.id, a1, cat),
      ]);
      const catExists = (await prisma.productCategory.count({ where: { id: cat } })) === 1;
      if (create!.status === "fulfilled") {
        if (catExists) {
          expect(del!.status).toBe("rejected");
          expect((del as PromiseRejectedResult).reason).toBeInstanceOf(CategoryNotEmptyError);
          expect((await prisma.product.findUniqueOrThrow({ where: { id: create!.value.id } })).categoryId).toBe(cat);
        } else {
          // the delete ran first on an empty category? impossible if create succeeded with that category
          throw new Error("category deleted although a product references it");
        }
      } else {
        expect(create!.reason).toBeInstanceOf(ValidationError);
        expect(del!.status).toBe("fulfilled");
        expect(catExists).toBe(false);
      }
    }
    const dangling = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Product" p WHERE p."categoryId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "ProductCategory" c WHERE c.id = p."categoryId" AND c."storeId" = p."storeId")`;
    expect(Number(dangling[0]!.n)).toBe(0);
  });

  it("editing a product into a category while that category is deleted never leaves a dangling reference", async () => {
    const { a, a1 } = await twoTenants();
    for (let i = 0; i < 10; i++) {
      const { id: cat } = await createCategory(a.id, a1, { name: `c ${i}` });
      const p = await createProduct(a.id, a1, validProduct({ name: `q ${i}` }));
      await Promise.allSettled([updateProduct(a.id, a1, p.id, { categoryId: cat }), deleteCategory(a.id, a1, cat, { moveProducts: true })]);
      const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
      expect(row.categoryId).toBeNull();
      expect(await prisma.productCategory.count({ where: { id: cat } })).toBe(0);
    }
  });
});

describe("concurrency: status and revision", () => {
  it("10 simultaneous DRAFT->ACTIVE requests: exactly one applies, the rest are rejected as 'already in this status'", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    const r0 = await revision(a1);
    const rs = await settle(Array.from({ length: 10 }, () => changeProductStatus(a.id, a1, p.id, "ACTIVE")));
    expect(ok(rs)).toHaveLength(1);
    expect(failed(rs).every((e) => e instanceof ValidationError && e.fieldErrors["status"])).toBe(true);
    expect(await revision(a1)).toBe(r0 + 1);
  });

  it("conflicting transitions (ACTIVE vs ARCHIVED) serialise: the final state is one of the legal outcomes", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    await settle([changeProductStatus(a.id, a1, p.id, "ACTIVE"), changeProductStatus(a.id, a1, p.id, "ARCHIVED")]);
    const { status } = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(["ACTIVE", "ARCHIVED"]).toContain(status); // ARCHIVED->ACTIVE can never happen
  });

  it("draftRevision equals 1 + the number of successful mutations under a mixed concurrent workload", async () => {
    const { a, a1 } = await twoTenants();
    const seed = await createProduct(a.id, a1, validProduct({ name: "seed" })); // +1
    const r0 = await revision(a1);
    const ops: Promise<unknown>[] = [
      ...Array.from({ length: 8 }, (_, i) => createProduct(a.id, a1, validProduct({ name: `n${i}` }))), // 8 ok
      ...Array.from({ length: 4 }, (_, i) => createCategory(a.id, a1, { name: `c${i}` })), // 4 ok
      createProduct(a.id, a1, validProduct({ price: -1 })), // invalid: rejected before the transaction
      createProduct(a.id, a1, validProduct({ slug: "dup", name: "d1" })), // wins or loses the slug race
      createProduct(a.id, a1, validProduct({ slug: "dup", name: "d2" })),
      updateProduct(a.id, a1, seed.id, { price: 99 }), // ok
      deleteProduct(a.id, a1, "missing"), // NotFound: rolled back
    ];
    const rs = await settle(ops);
    const successes = rs.filter((r) => r.status === "fulfilled").length;
    expect(successes).toBe(8 + 4 + 1 + 1); // 8 creates + 4 categories + exactly one "dup" + the update
    expect(await revision(a1)).toBe(r0 + successes);
  });
});
