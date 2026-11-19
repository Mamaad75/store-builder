import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "./db-helpers";
import { twoTenants } from "./catalog-helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

let n = 0;
/** Raw INSERT so the application layer (and its normalisation) is bypassed entirely. */
async function rawProduct(storeId: string, over: Record<string, unknown> = {}) {
  n += 1;
  const v = { name: `n${n}`, slug: `s${n}`, price: 1, stockQuantity: 0, searchKey: `n${n}`, description: "", ...over };
  return prisma.$executeRawUnsafe(
    `INSERT INTO "Product" ("id","storeId","name","slug","price","stockQuantity","searchKey","description","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
    `raw${n}`, storeId, v.name, v.slug, v.price, v.stockQuantity, v.searchKey, v.description,
  );
}
async function rawCategory(storeId: string, over: Record<string, unknown> = {}) {
  n += 1;
  const v = { name: `c${n}`, slug: `cs${n}`, ...over };
  return prisma.$executeRawUnsafe(`INSERT INTO "ProductCategory" ("id","storeId","name","slug") VALUES ($1,$2,$3,$4)`, `rawc${n}`, storeId, v.name, v.slug);
}

describe("database CHECK constraints (application bypassed)", () => {
  it("accepts a valid row", async () => {
    const { a1 } = await twoTenants();
    await expect(rawProduct(a1, { name: "چای سبز", slug: "چای-سبز", searchKey: "چای سبز 120" })).resolves.toBe(1);
  });

  it.each([
    ["stock below 0", { stockQuantity: -1 }],
    ["stock above 1,000,000", { stockQuantity: 1_000_001 }],
    ["price below 0", { price: -1 }],
    ["price above 1,000,000,000", { price: 1_000_000_001 }],
    ["description above 5000 chars", { description: "x".repeat(5001) }],
    ["empty slug", { slug: "" }],
    ["slug longer than 80", { slug: "a".repeat(81) }],
    ["slug with a space", { slug: "a b" }],
    ["slug with a slash", { slug: "a/b" }],
    ["slug with a question mark", { slug: "a?b" }],
    ["slug with a percent sign", { slug: "a%b" }],
    ["slug starting with a hyphen", { slug: "-a" }],
    ["slug ending with a hyphen", { slug: "a-" }],
    ["slug with Arabic yeh", { slug: "علي" }],
    ["slug with Arabic kaf", { slug: "كتاب" }],
    ["name with Arabic yeh", { name: "علي" }],
    ["name with Arabic kaf", { name: "كتاب" }],
    ["name with alef maksura", { name: "موسى" }],
    ["blank name", { name: "   " }],
    ["name longer than 120", { name: "x".repeat(121) }],
    ["searchKey with uppercase", { searchKey: "Tea" }],
    ["searchKey with Persian digits", { searchKey: "چای ۱۲" }],
    ["searchKey with Arabic-Indic digits", { searchKey: "چای ١٢" }],
    ["searchKey with Arabic yeh", { searchKey: "علي" }],
  ])("rejects: %s", async (_label, over) => {
    const { a1 } = await twoTenants();
    await expect(rawProduct(a1, over)).rejects.toThrow(/check constraint|violates/i);
    expect(await prisma.product.count()).toBe(0);
  });

  it.each([
    ["category name with Arabic yeh", { name: "علي" }],
    ["category name longer than 60", { name: "x".repeat(61) }],
    ["blank category name", { name: " " }],
    ["category slug with a space", { slug: "a b" }],
    ["category slug with Arabic kaf", { slug: "كتاب" }],
    ["category slug starting with a hyphen", { slug: "-x" }],
  ])("rejects: %s", async (_label, over) => {
    const { a1 } = await twoTenants();
    await expect(rawCategory(a1, over)).rejects.toThrow(/check constraint|violates/i);
  });

  it("accepts the boundaries", async () => {
    const { a1 } = await twoTenants();
    await rawProduct(a1, { stockQuantity: 1_000_000, price: 1_000_000_000, slug: "a".repeat(80), name: "x".repeat(120), description: "d".repeat(5000) });
    await rawProduct(a1, { stockQuantity: 0, price: 0 });
  });
});

describe("database relational constraints", () => {
  it("slug is unique per store only", async () => {
    const { a1, a2 } = await twoTenants();
    await rawProduct(a1, { slug: "same" });
    await expect(rawProduct(a1, { slug: "same" })).rejects.toThrow(/23505|already exists/i);
    await rawProduct(a2, { slug: "same" });
  });

  it("category name and slug are unique per store only", async () => {
    const { a1, a2 } = await twoTenants();
    await rawCategory(a1, { name: "چای", slug: "tea" });
    await expect(rawCategory(a1, { name: "چای", slug: "other" })).rejects.toThrow(/23505|already exists/i);
    await expect(rawCategory(a1, { name: "other", slug: "tea" })).rejects.toThrow(/23505|already exists/i);
    await rawCategory(a2, { name: "چای", slug: "tea" });
  });

  it("a product cannot reference a category of another store, even by raw SQL", async () => {
    const { a1, b1 } = await twoTenants();
    await rawCategory(b1, { name: "B cat", slug: "bcat" });
    const bCat = (await prisma.productCategory.findFirstOrThrow({ where: { storeId: b1 } })).id;
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Product" ("id","storeId","categoryId","name","slug","price","searchKey","updatedAt") VALUES ('x1',$1,$2,'n','s',1,'n',now())`,
        a1, bCat,
      ),
    ).rejects.toThrow(/foreign key/i);
    expect(await prisma.product.count()).toBe(0);
  });

  it("a category that still has products cannot be deleted (Restrict), even by raw SQL", async () => {
    const { a1 } = await twoTenants();
    await rawCategory(a1, { name: "c", slug: "c" });
    const cat = (await prisma.productCategory.findFirstOrThrow({ where: { storeId: a1 } })).id;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Product" ("id","storeId","categoryId","name","slug","price","searchKey","updatedAt") VALUES ('x2',$1,$2,'n','s',1,'n',now())`, a1, cat);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ProductCategory" WHERE id = $1`, cat)).rejects.toThrow(/foreign key/i);
  });

  it("the ARCHIVED status exists and the old inStock column is gone", async () => {
    const { a1 } = await twoTenants();
    await rawProduct(a1);
    await prisma.$executeRawUnsafe(`UPDATE "Product" SET "status" = 'ARCHIVED'`);
    expect((await prisma.product.findFirstOrThrow()).status).toBe("ARCHIVED");
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'Product'`;
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("inStock");
    expect(names).not.toContain("lastPublishedSlug");
    expect(names).toEqual(expect.arrayContaining(["stockQuantity", "searchKey"]));
  });

  it("deleting a store removes its products and categories (cascade) and nothing else", async () => {
    const { a1, a2 } = await twoTenants();
    await rawCategory(a1, { name: "c", slug: "c" });
    await rawProduct(a1);
    await rawProduct(a2);
    await prisma.store.delete({ where: { id: a1 } });
    expect(await prisma.product.count({ where: { storeId: a1 } })).toBe(0);
    expect(await prisma.productCategory.count({ where: { storeId: a1 } })).toBe(0);
    expect(await prisma.product.count({ where: { storeId: a2 } })).toBe(1);
  });
});
