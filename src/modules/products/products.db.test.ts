import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { revision, snapshotRows, twoTenants, validProduct } from "@/test/catalog-helpers";
import { createCategory } from "@/modules/categories/service";
import { CatalogLimitError, NotFoundError, ValidationError } from "@/modules/stores/errors";
import {
  type GetPublishedSlug,
  SLUG_CONFIRM_MESSAGE,
  changeProductStatus,
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "./service";
import { ProductRepository } from "./repository";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const fieldError = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(ValidationError);
  return (e as ValidationError).fieldErrors;
};

describe("createProduct", () => {
  it("creates a DRAFT product with normalised name, generated slug, search key and bumps draftRevision once", async () => {
    const { a, a1 } = await twoTenants();
    const r0 = await revision(a1);
    const p = await createProduct(a.id, a1, validProduct({ name: " چاي  سبز ۱۲۰ گرم ", description: "توضیح\r\n\r\n\r\nمفصل" }));
    expect(p).toMatchObject({ name: "چای سبز ۱۲۰ گرم", slug: "چای-سبز-120-گرم", status: "DRAFT", price: 12500, stockQuantity: 5, categoryId: null });
    expect(p.description).toBe("توضیح\n\nمفصل");
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ searchKey: "چای سبز 120 گرم", storeId: a1 });
    expect(await revision(a1)).toBe(r0 + 1);
  });

  it("generates unique slugs for identical names (base, base-2, base-3)", async () => {
    const { a, a1 } = await twoTenants();
    const slugs = [];
    for (let i = 0; i < 3; i++) slugs.push((await createProduct(a.id, a1, validProduct({ name: "Green Tea" }))).slug);
    expect(slugs).toEqual(["green-tea", "green-tea-2", "green-tea-3"]);
  });

  it("sanitises an explicit slug and rejects one that is taken in the same store, but allows it in another", async () => {
    const { a, a1, a2 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ slug: " My  Special SLUG! " }));
    expect(p.slug).toBe("my-special-slug");
    expect((await fieldError(createProduct(a.id, a1, validProduct({ slug: "my-special-slug" }))))["slug"]).toBeTruthy();
    expect((await createProduct(a.id, a2, validProduct({ slug: "my-special-slug" }))).slug).toBe("my-special-slug");
    expect((await fieldError(createProduct(a.id, a1, validProduct({ slug: "!!!" }))))["slug"]).toBeTruthy();
  });

  it("accepts the price and stock boundaries and rejects values outside them, creating nothing", async () => {
    const { a, a1 } = await twoTenants();
    await createProduct(a.id, a1, validProduct({ name: "free", price: 0, stockQuantity: 0 }));
    await createProduct(a.id, a1, validProduct({ name: "max", price: 1_000_000_000, stockQuantity: 1_000_000 }));
    await createProduct(a.id, a1, validProduct({ name: "typed", price: "۱۲٬۵۰۰", stockQuantity: "٣" }));
    expect((await prisma.product.findFirstOrThrow({ where: { name: "typed" } })).price).toBe(12500);
    const r = await revision(a1);
    const bads = [
      { price: -1 }, { price: 1_000_000_001 }, { price: 12.5 }, { price: "12.5" }, { price: "abc" }, { price: null }, { price: undefined },
      { stockQuantity: -1 }, { stockQuantity: 1_000_001 }, { stockQuantity: 1.5 }, { name: "" }, { name: "   " }, { name: "x".repeat(121) },
      { description: "x".repeat(5001) },
    ];
    for (const bad of bads) await expect(createProduct(a.id, a1, validProduct(bad))).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.product.count({ where: { storeId: a1 } })).toBe(3);
    expect(await revision(a1)).toBe(r);
  });

  it.each(["status", "ownerId", "userId", "storeId", "id", "searchKey", "confirmSlugChange", "imageId", "createdAt"])(
    "rejects mass-assignment of %s",
    async (key) => {
      const { a, a1 } = await twoTenants();
      await expect(createProduct(a.id, a1, validProduct({ [key]: "x" }))).rejects.toBeInstanceOf(ValidationError);
      expect(await prisma.product.count()).toBe(0);
    },
  );

  it("a product with zero stock is not hidden, archived or changed in any way", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ stockQuantity: 0 }));
    expect(p.status).toBe("DRAFT");
    const active = await changeProductStatus(a.id, a1, p.id, "ACTIVE");
    expect(active).toMatchObject({ status: "ACTIVE", stockQuantity: 0 });
    const updated = await updateProduct(a.id, a1, p.id, { stockQuantity: 0, price: 5 });
    expect(updated.status).toBe("ACTIVE");
  });

  it("enforces the 500-product limit", async () => {
    const { a, a1 } = await twoTenants();
    await prisma.product.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ storeId: a1, name: `p${i}`, slug: `p${i}`, price: 1, searchKey: `p${i}` })),
    });
    await expect(createProduct(a.id, a1, validProduct())).rejects.toBeInstanceOf(CatalogLimitError);
    expect(await prisma.product.count({ where: { storeId: a1 } })).toBe(500);
  });
});

describe("categories on products (no cross-store references)", () => {
  it("accepts a category of the same store, and rejects another store's category (same owner or other owner) or a missing one with the same error", async () => {
    const { a, b, a1, a2, b1 } = await twoTenants();
    const own = (await createCategory(a.id, a1, { name: "من" })).id;
    const sameOwnerOtherStore = (await createCategory(a.id, a2, { name: "دیگری" })).id;
    const otherTenant = (await createCategory(b.id, b1, { name: "بیگانه" })).id;
    const ok = await createProduct(a.id, a1, validProduct({ categoryId: own }));
    expect(ok.categoryId).toBe(own);

    const r = await revision(a1);
    const errs: Record<string, string[]>[] = [];
    for (const id of [sameOwnerOtherStore, otherTenant, "nonexistent-id"]) {
      errs.push(await fieldError(createProduct(a.id, a1, validProduct({ name: "x", categoryId: id }))));
    }
    expect(errs.every((e) => JSON.stringify(e) === JSON.stringify(errs[0]))).toBe(true);
    expect(errs[0]!["categoryId"]).toBeTruthy();
    expect(await prisma.product.count({ where: { storeId: a1 } })).toBe(1);
    expect(await revision(a1)).toBe(r); // failed mutation rolled back, no bump

    for (const id of [sameOwnerOtherStore, otherTenant]) {
      expect((await fieldError(updateProduct(a.id, a1, ok.id, { categoryId: id })))["categoryId"]).toBeTruthy();
    }
    expect((await getProduct(a.id, a1, ok.id)).categoryId).toBe(own);
    // clearing is allowed
    expect((await updateProduct(a.id, a1, ok.id, { categoryId: "" })).categoryId).toBeNull();
    await expect(a2).toBeTruthy();
    void b;
  });
});

describe("tenant isolation: User A cannot touch User B's products", () => {
  async function seedB() {
    const t = await twoTenants();
    const bp = await createProduct(t.b.id, t.b1, validProduct({ name: "محصول محرمانه", slug: "secret" }));
    const ap = await createProduct(t.a.id, t.a1, validProduct({ name: "محصول الف" }));
    return { ...t, bp, ap };
  }

  it("get/update/status/delete on B's product -> NotFoundError identical to a missing id; B's data unchanged", async () => {
    const { a, a1, b1, bp } = await seedB();
    const before = await snapshotRows(b1);
    const attempts: [string, () => Promise<unknown>][] = [
      ["get", () => getProduct(a.id, b1, bp.id)],
      ["update", () => updateProduct(a.id, b1, bp.id, { name: "pwned", price: 1 })],
      ["status", () => changeProductStatus(a.id, b1, bp.id, "ACTIVE")],
      ["delete", () => deleteProduct(a.id, b1, bp.id)],
      ["list", () => listProducts(a.id, b1, {})],
      ["create", () => createProduct(a.id, b1, validProduct())],
    ];
    for (const [label, fn] of attempts) {
      const foreign = await fn().catch((e) => e);
      expect(foreign, label).toBeInstanceOf(NotFoundError);
    }
    // a foreign product id through A's OWN store is also not found
    for (const fn of [
      () => getProduct(a.id, a1, bp.id),
      () => updateProduct(a.id, a1, bp.id, { name: "pwned" }),
      () => changeProductStatus(a.id, a1, bp.id, "ACTIVE"),
      () => deleteProduct(a.id, a1, bp.id),
    ]) {
      const e = await fn().catch((x) => x);
      const m = await Promise.resolve().then(() => getProduct(a.id, a1, "missing-id")).catch((x) => x);
      expect(e).toBeInstanceOf(NotFoundError);
      expect(e.message).toBe(m.message);
      expect(e.name).toBe(m.name);
    }
    expect(await snapshotRows(b1)).toBe(before);
  });

  it("listing and searching never return another store's or tenant's products", async () => {
    const { a, a1, a2, ap } = await seedB();
    await createProduct(a.id, a2, validProduct({ name: "محصول الف" })); // same name in A's other store
    for (const q of ["محصول", "الف", "secret", "محرمانه", "%", "_", "a"]) {
      const res = await listProducts(a.id, a1, { q });
      expect(res.items.every((i) => i.id === ap.id)).toBe(true);
      expect(JSON.stringify(res)).not.toContain("محرمانه");
    }
    const all = await listProducts(a.id, a1, {});
    expect(all.total).toBe(1);
    expect((await listProducts(a.id, a2, {})).total).toBe(1);
  });

  it("a product of another store of the same owner is unreachable through this store's id", async () => {
    const { a, a1, a2 } = await seedB();
    const p2 = await createProduct(a.id, a2, validProduct({ name: "فقط در دوم" }));
    await expect(getProduct(a.id, a1, p2.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateProduct(a.id, a1, p2.id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteProduct(a.id, a1, p2.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.product.count({ where: { id: p2.id } })).toBe(1);
  });
});

describe("ProductRepository is owner-bound (not only the service in front of it)", () => {
  it("reads never cross tenants or stores, even when called directly with foreign ids", async () => {
    const { a, b, a1, a2, b1 } = await twoTenants();
    const bp = await createProduct(b.id, b1, validProduct({ name: "محرمانه" }));
    const ap2 = await createProduct(a.id, a2, validProduct({ name: "دوم" }));
    const repo = new ProductRepository(a.id);
    const none = { page: 1, pageSize: 20 };
    expect((await repo.list(b1, none)).total).toBe(0);
    expect((await repo.list(b1, { ...none, q: "محرمانه" })).items).toEqual([]);
    expect(await repo.find(b1, bp.id)).toBeNull();
    expect(await repo.find(a1, bp.id)).toBeNull();
    expect(await repo.find(a1, ap2.id)).toBeNull(); // same owner, different store
    expect((await repo.list(a2, none)).items.map((i) => i.id)).toEqual([ap2.id]);
    expect(() => new ProductRepository("")).toThrow();
  });
});

describe("updateProduct", () => {
  it("never changes the slug when the name changes; recomputes the search key; bumps the revision once", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ name: "چای سبز" }));
    const r = await revision(a1);
    const u = await updateProduct(a.id, a1, p.id, { name: "چاي ممتاز", price: 20000 });
    expect(u.slug).toBe(p.slug);
    expect(u).toMatchObject({ name: "چای ممتاز", price: 20000 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).searchKey).toBe("چای ممتاز");
    expect(await revision(a1)).toBe(r + 1);
  });

  it("a save without real changes does not write or bump draftRevision", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    const r = await revision(a1);
    const same = await updateProduct(a.id, a1, p.id, { name: "چاي سبز", price: "۱۲٬۵۰۰", slug: p.slug, stockQuantity: 5 });
    expect(same.updatedAt.getTime()).toBe(p.updatedAt.getTime());
    expect(await revision(a1)).toBe(r);
  });

  it("changes the slug freely for a never-published product, rejecting taken slugs", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ name: "one" }));
    await createProduct(a.id, a1, validProduct({ name: "two" }));
    expect((await updateProduct(a.id, a1, p.id, { slug: "NEW slug" })).slug).toBe("new-slug");
    expect((await fieldError(updateProduct(a.id, a1, p.id, { slug: "two" })))["slug"]).toBeTruthy();
    expect((await getProduct(a.id, a1, p.id)).slug).toBe("new-slug");
  });

  describe("slug change of a product that is live on the storefront (injected getPublishedSlug)", () => {
    // Nothing can be published before Phase 10, so the "published" answer is injected here.
    it("requires explicit confirmation, explains why, and leaves everything untouched when unconfirmed", async () => {
      const { a, a1 } = await twoTenants();
      const p = await createProduct(a.id, a1, validProduct({ name: "published one" }));
      const other = await createProduct(a.id, a1, validProduct({ name: "unpublished one" }));
      const calls: string[] = [];
      const getPublishedSlug: GetPublishedSlug = async (_ctx, id) => {
        calls.push(id);
        return id === p.id ? p.slug : null; // only `p` is live
      };
      const deps = { getPublishedSlug };
      const r = await revision(a1);

      const errs = await fieldError(updateProduct(a.id, a1, p.id, { slug: "renamed" }, deps));
      expect(errs["slug"]).toEqual([SLUG_CONFIRM_MESSAGE]);
      await expect(updateProduct(a.id, a1, p.id, { slug: "renamed", confirmSlugChange: false }, deps)).rejects.toBeInstanceOf(ValidationError);
      expect((await getProduct(a.id, a1, p.id)).slug).toBe(p.slug);
      expect(await revision(a1)).toBe(r); // rejected => rolled back, no bump

      // a name change alone never needs confirmation and never moves the URL
      const renamed = await updateProduct(a.id, a1, p.id, { name: "totally different name" }, deps);
      expect(renamed.slug).toBe(p.slug);

      // confirmed change goes through
      const confirmed = await updateProduct(a.id, a1, p.id, { slug: "renamed", confirmSlugChange: true }, deps);
      expect(confirmed.slug).toBe("renamed");

      // a product that is not live is unaffected by the rule
      expect((await updateProduct(a.id, a1, other.id, { slug: "free-to-change" }, deps)).slug).toBe("free-to-change");
      expect(calls.every((id) => [p.id, other.id].includes(id))).toBe(true);
    });

    it("is consulted only when the slug really changes", async () => {
      const { a, a1 } = await twoTenants();
      const p = await createProduct(a.id, a1, validProduct());
      let calls = 0;
      const deps = { getPublishedSlug: async () => { calls += 1; return p.slug; } };
      await updateProduct(a.id, a1, p.id, { slug: p.slug, price: 777 }, deps); // same slug
      await updateProduct(a.id, a1, p.id, { name: "new name" }, deps); // no slug supplied
      expect(calls).toBe(0);
    });

    it("by default (Phase 5, nothing published) the slug can be changed without confirmation", async () => {
      const { a, a1 } = await twoTenants();
      const p = await createProduct(a.id, a1, validProduct());
      expect((await updateProduct(a.id, a1, p.id, { slug: "plain-change" })).slug).toBe("plain-change");
    });
  });

  it("cannot change status through update (strict schema)", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    await expect(updateProduct(a.id, a1, p.id, { status: "ACTIVE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProduct(a.id, a1, p.id, { storeId: "x" })).rejects.toBeInstanceOf(ValidationError);
    expect((await getProduct(a.id, a1, p.id)).status).toBe("DRAFT");
  });

  it("validates ranges on update and leaves the row untouched", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    const before = await snapshotRows(a1);
    for (const bad of [{ price: -5 }, { price: 2_000_000_000 }, { stockQuantity: -1 }, { stockQuantity: 2_000_000 }, { name: "" }]) {
      await expect(updateProduct(a.id, a1, p.id, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await snapshotRows(a1)).toBe(before);
  });
});

describe("changeProductStatus", () => {
  const ALL = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
  const allowed = new Set(["DRAFT>ACTIVE", "DRAFT>ARCHIVED", "ACTIVE>DRAFT", "ACTIVE>ARCHIVED", "ARCHIVED>DRAFT"]);

  for (const from of ALL) {
    for (const to of ALL) {
      it(`${from} -> ${to} is ${allowed.has(`${from}>${to}`) ? "applied" : "rejected without any change"}`, async () => {
        const { a, a1 } = await twoTenants();
        const p = await createProduct(a.id, a1, validProduct({ stockQuantity: 0 }));
        if (from !== "DRAFT") await prisma.product.update({ where: { id: p.id }, data: { status: from } });
        const rev = await revision(a1);
        if (allowed.has(`${from}>${to}`)) {
          expect((await changeProductStatus(a.id, a1, p.id, to)).status).toBe(to);
          expect(await revision(a1)).toBe(rev + 1);
        } else {
          expect((await fieldError(changeProductStatus(a.id, a1, p.id, to)))["status"]).toBeTruthy();
          expect((await getProduct(a.id, a1, p.id)).status).toBe(from);
          expect(await revision(a1)).toBe(rev); // rejected => rolled back, no bump
        }
      });
    }
  }

  it("rejects unknown statuses and non-owners", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    for (const bad of ["PUBLISHED", "", null, 5, "active"]) await expect(changeProductStatus(a.id, a1, p.id, bad)).rejects.toBeInstanceOf(ValidationError);
    await expect(changeProductStatus(b.id, a1, p.id, "ACTIVE")).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeProductStatus(a.id, b1, p.id, "ACTIVE")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stock changes never change status, and archiving keeps stock", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ stockQuantity: 3 }));
    await changeProductStatus(a.id, a1, p.id, "ACTIVE");
    expect((await updateProduct(a.id, a1, p.id, { stockQuantity: 0 })).status).toBe("ACTIVE");
    const arch = await changeProductStatus(a.id, a1, p.id, "ARCHIVED");
    expect(arch).toMatchObject({ status: "ARCHIVED", stockQuantity: 0 });
    expect((await updateProduct(a.id, a1, p.id, { stockQuantity: 9 })).status).toBe("ARCHIVED");
  });
});

describe("deleteProduct", () => {
  it("deletes, bumps the revision, and a second delete is a NotFoundError that does not bump", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    const r = await revision(a1);
    await deleteProduct(a.id, a1, p.id);
    expect(await prisma.product.count({ where: { id: p.id } })).toBe(0);
    expect(await revision(a1)).toBe(r + 1);
    await expect(deleteProduct(a.id, a1, p.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await revision(a1)).toBe(r + 1);
  });
});

describe("search, filters and pagination", () => {
  async function seed() {
    const t = await twoTenants();
    const cat = (await createCategory(t.a.id, t.a1, { name: "چای" })).id;
    const names = [
      ["چای سبز ۱۲۰ گرم", cat], ["چاي سياه", cat], ["قهوه ترک", null], ["كتاب آشپزی", null], ["Green TEA", cat],
      ["100% pure honey", null], ["1000 pure salt", null], ["a_b item", null], ["می‌خواهم", null],
    ] as const;
    const made = [];
    for (const [name, categoryId] of names) made.push(await createProduct(t.a.id, t.a1, validProduct({ name, categoryId })));
    await changeProductStatus(t.a.id, t.a1, made[0]!.id, "ACTIVE");
    await changeProductStatus(t.a.id, t.a1, made[2]!.id, "ARCHIVED");
    return { ...t, cat, made };
  }
  const names = async (ownerId: string, storeId: string, p: Parameters<typeof listProducts>[2]) =>
    (await listProducts(ownerId, storeId, p)).items.map((i) => i.name).sort();

  it("finds products regardless of Persian/Arabic letter and digit variants, case, ZWNJ and harakat", async () => {
    const { a, a1 } = await seed();
    for (const q of ["چای", "چاي", "چَای", "ﭼﺎﻱ"]) expect(await names(a.id, a1, { q })).toEqual(["چای سبز ۱۲۰ گرم", "چای سیاه"].sort());
    for (const q of ["کتاب", "كتاب", "ﻛﺘﺎﺏ"]) expect(await names(a.id, a1, { q })).toEqual(["کتاب آشپزی"]);
    for (const q of ["120", "۱۲۰", "١٢٠"]) expect(await names(a.id, a1, { q })).toEqual(["چای سبز ۱۲۰ گرم"]);
    for (const q of ["green", "GREEN TEA", "green-tea"]) expect(await names(a.id, a1, { q })).toEqual(["Green TEA"]);
    for (const q of ["می خواهم", "می‌خواهم", "می-خواهم"]) expect(await names(a.id, a1, { q })).toEqual(["می‌خواهم"]);
  });

  it("matches slugs too, and treats % and _ literally", async () => {
    const { a, a1 } = await seed();
    expect(await names(a.id, a1, { q: "green-tea" })).toEqual(["Green TEA"]);
    expect(await names(a.id, a1, { q: "100%" })).toEqual(["100% pure honey"]);
    expect(await names(a.id, a1, { q: "a_b" })).toEqual(["a_b item"]);
    expect((await listProducts(a.id, a1, { q: "%" })).total).toBe(1);
    expect((await listProducts(a.id, a1, { q: "_" })).total).toBe(1);
    expect((await listProducts(a.id, a1, { q: "zzz" })).total).toBe(0);
  });

  it("filters by category (including 'none') and status, and combines filters", async () => {
    const { a, a1, cat } = await seed();
    expect((await listProducts(a.id, a1, { category: cat })).total).toBe(3);
    expect((await listProducts(a.id, a1, { category: "none" })).total).toBe(6);
    expect((await listProducts(a.id, a1, { category: "unknown-id" })).total).toBe(0);
    expect((await listProducts(a.id, a1, { status: "ACTIVE" })).total).toBe(1);
    expect((await listProducts(a.id, a1, { status: "ARCHIVED" })).total).toBe(1);
    expect((await listProducts(a.id, a1, { status: "DRAFT" })).total).toBe(7);
    expect((await listProducts(a.id, a1, { category: cat, status: "DRAFT", q: "green" })).total).toBe(1);
    expect((await listProducts(a.id, a1, { category: cat, status: "ARCHIVED" })).total).toBe(0);
  });

  it("paginates with a stable order, no duplicates or gaps, clamps the page and the page size", async () => {
    const { a, a1 } = await twoTenants();
    for (let i = 0; i < 45; i++) await createProduct(a.id, a1, validProduct({ name: `کالا ${i}` }));
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await listProducts(a.id, a1, { page, pageSize: 20 });
      expect(res).toMatchObject({ total: 45, totalPages: 3, page });
      expect(res.items.length).toBe(page === 3 ? 5 : 20);
      seen.push(...res.items.map((i) => i.id));
    }
    expect(new Set(seen).size).toBe(45);
    const beyond = await listProducts(a.id, a1, { page: 99, pageSize: 20 });
    expect(beyond).toMatchObject({ page: 3, totalPages: 3 });
    expect(beyond.items.length).toBe(5);
    expect((await listProducts(a.id, a1, { pageSize: 1000 })).pageSize).toBe(50);
    expect((await listProducts(a.id, a1, { page: -4, pageSize: 0 })).page).toBe(1);
    expect((await listProducts(a.id, a1, {})).pageSize).toBe(20);
    const withSearch = await listProducts(a.id, a1, { q: "کالا 4", page: 1, pageSize: 20 });
    expect(withSearch.total).toBe(6); // 4, 40..44
  });
});
