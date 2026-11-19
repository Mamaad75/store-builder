import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "@/modules/auth/rate-limit";
import { setMediaStorageForTests } from "@/lib/storage";
import { analyzeSpecs, specsInputSchema } from "@/lib/product-specs";
import { attachProductImage, uploadMedia } from "@/modules/media/service";
import { readPublishedStorefront } from "@/modules/storefront/published";
import { getDraftPreview } from "@/modules/storefront/service";
import { NotFoundError, ValidationError } from "@/modules/stores/errors";
import { switchTheme, previewThemeSwitch } from "@/modules/stores/theme-switch";
import { createCategory } from "@/modules/categories/service";
import { revision, twoTenants, validProduct } from "@/test/catalog-helpers";
import { prisma, resetDb } from "@/test/db-helpers";
import { MemoryMediaStorage } from "@/test/memory-storage";
import { changeProductStatus, createProduct, getProduct, listProducts, updateProduct } from "./service";
import { specsFromForm } from "./specs-form";

beforeEach(resetDb);
afterEach(() => setMediaStorageForTests(undefined));
afterAll(() => prisma.$disconnect());

const GOOD = [{ label: "برند", value: "الف" }, { label: "ظرفیت", value: "۷ کیلوگرم" }];
/** Stored values that fail validation, in the ways old data, direct SQL or a future rule change could produce. */
const INVALID: [string, unknown][] = [
  ["empty label", [{ label: "", value: "x" }]],
  ["row with an extra key", [{ label: "l", value: "v", extra: 1 }]],
  ["value too long", [{ label: "l", value: "v".repeat(121) }]],
  ["duplicate labels", [{ label: "l", value: "a" }, { label: "L", value: "b" }]],
  ["not objects", ["a", 1, null]],
  ["a control character", [{ label: "l", value: "a\u0001b" }]],
];

const setRaw = (id: string, json: unknown) => prisma.$executeRaw`UPDATE "Product" SET "specs" = ${JSON.stringify(json)}::jsonb WHERE id = ${id}`;
/** The stored value exactly as PostgreSQL holds it (text form), to prove byte-for-byte preservation. */
const storedText = async (id: string) => (await prisma.$queryRaw<{ t: string }[]>`SELECT "specs"::text AS t FROM "Product" WHERE id = ${id}`)[0]!.t;

describe("default and creation", () => {
  it("existing products read as an empty list: a row inserted WITHOUT the column (as before the migration) gets the default", async () => {
    const { a1 } = await twoTenants();
    await prisma.$executeRaw`INSERT INTO "Product" ("id","storeId","name","slug","price","searchKey","updatedAt") VALUES ('legacy1', ${a1}, 'قدیمی', 'legacy', 10, 'قدیمی', now())`;
    expect(await storedText("legacy1")).toBe("[]");
    const p = await getProduct((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).ownerId, a1, "legacy1");
    expect(analyzeSpecs(p.specs)).toEqual({ ok: true, rows: [] });
  });

  it("creates with normalised specs, or with none (default empty)", async () => {
    const { a, a1 } = await twoTenants();
    const withSpecs = await createProduct(a.id, a1, validProduct({ name: "یخچال", specs: [{ label: " ظرفيت ", value: "۷۰۰ ليتر" }] }));
    expect(withSpecs.specs).toEqual([{ label: "ظرفیت", value: "۷۰۰ لیتر" }]);
    const without = await createProduct(a.id, a1, validProduct({ name: "کتری" }));
    expect(without.specs).toEqual([]);
  });

  it("rejects invalid input and creates nothing", async () => {
    const { a, a1 } = await twoTenants();
    for (const specs of [[{ label: "", value: "x" }], [{ label: "l", value: "v".repeat(121) }], Array.from({ length: 31 }, (_, i) => ({ label: `l${i}`, value: "v" })), [{ label: "a", value: "1" }, { label: "A", value: "2" }]]) {
      await expect(createProduct(a.id, a1, validProduct({ specs }))).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await prisma.product.count({ where: { storeId: a1 } })).toBe(0);
  });
});

describe("the database backstop", () => {
  it("accepts an array of up to 30 elements and refuses non-arrays and oversized arrays, even when the service is bypassed", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    await expect(setRaw(p.id, Array.from({ length: 30 }, (_, i) => ({ label: `l${i}`, value: "v" })))).resolves.toBeDefined();
    await expect(setRaw(p.id, Array.from({ length: 31 }, (_, i) => ({ label: `l${i}`, value: "v" })))).rejects.toThrow();
    await expect(setRaw(p.id, { label: "l", value: "v" })).rejects.toThrow();
    await expect(setRaw(p.id, "text")).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "Product" SET "specs" = 'null'::jsonb WHERE id = ${p.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "Product" SET "specs" = NULL WHERE id = ${p.id}`).rejects.toThrow(); // NOT NULL
  });
});

describe("updating specs", () => {
  it("replaces, clears, and leaves them alone when the field is absent; unrelated edits never touch valid specs", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ specs: GOOD }));
    expect((await updateProduct(a.id, a1, p.id, { name: "نام جدید" })).specs).toEqual(GOOD);
    expect((await updateProduct(a.id, a1, p.id, { specs: [{ label: "رنگ", value: "سفید" }] })).specs).toEqual([{ label: "رنگ", value: "سفید" }]);
    expect((await updateProduct(a.id, a1, p.id, { price: 5 })).specs).toEqual([{ label: "رنگ", value: "سفید" }]);
    expect((await updateProduct(a.id, a1, p.id, { specs: [] })).specs).toEqual([]);
  });

  it("saving identical specs is a no-op: nothing written, draftRevision not bumped", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ specs: GOOD }));
    const before = await storedText(p.id);
    const rev = await revision(a1);
    const updatedAt = (await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).updatedAt;
    await updateProduct(a.id, a1, p.id, { specs: GOOD });
    await updateProduct(a.id, a1, p.id, { specs: [{ label: " برند ", value: "الف" }, { label: "ظرفيت", value: "۷ كيلوگرم" }] }); // normalises to the same rows
    expect(await storedText(p.id)).toBe(before);
    expect(await revision(a1)).toBe(rev);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).updatedAt).toEqual(updatedAt);
  });

  it("a real spec change bumps draftRevision once", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    const rev = await revision(a1);
    await updateProduct(a.id, a1, p.id, { specs: GOOD });
    expect(await revision(a1)).toBe(rev + 1);
  });

  it("invalid input is a ValidationError and leaves the stored specs untouched", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ specs: GOOD }));
    const before = await storedText(p.id);
    for (const specs of [[{ label: "", value: "x" }], [{ label: "l", value: "v".repeat(121) }], "x", [{ label: "l", value: "v", extra: 1 }]]) {
      await expect(updateProduct(a.id, a1, p.id, { specs })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await storedText(p.id)).toBe(before);
  });

  it("another tenant can neither read nor change a product's specs (same NotFound as a missing product)", async () => {
    const { a, b, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ specs: GOOD }));
    await expect(updateProduct(b.id, a1, p.id, { specs: [] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getProduct(b.id, a1, p.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(analyzeSpecs((await getProduct(a.id, a1, p.id)).specs)).toEqual({ ok: true, rows: GOOD });
  });
});

describe("INVALID stored specifications are never silently lost or replaced", () => {
  it.each(INVALID)("%s: an unrelated edit (name, price, description, stock, category, slug) keeps the stored value byte-for-byte", async (_n, raw) => {
    const { a, a1 } = await twoTenants();
    const cat = await createCategory(a.id, a1, { name: "لوازم" });
    const p = await createProduct(a.id, a1, validProduct());
    await setRaw(p.id, raw);
    const before = await storedText(p.id);
    expect(analyzeSpecs((await getProduct(a.id, a1, p.id)).specs).ok).toBe(false);

    await updateProduct(a.id, a1, p.id, { name: "نام دیگر" });
    await updateProduct(a.id, a1, p.id, { price: 9999 });
    await updateProduct(a.id, a1, p.id, { description: "توضیح تازه" });
    await updateProduct(a.id, a1, p.id, { stockQuantity: 3 });
    await updateProduct(a.id, a1, p.id, { categoryId: cat.id });
    await updateProduct(a.id, a1, p.id, { slug: "slug-dige" });
    await updateProduct(a.id, a1, p.id, { name: "نام سوم", price: 1, description: "x", stockQuantity: 0, categoryId: null, slug: "slug-sevom" });
    expect(await storedText(p.id)).toBe(before);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.name).toBe("نام سوم"); // the unrelated edits themselves did apply
  });

  it("status changes, activation and image attachment do not touch them either", async () => {
    const { a, a1 } = await twoTenants();
    const storage = new MemoryMediaStorage();
    setMediaStorageForTests(storage);
    const deps = { storage, limiter: new MemoryRateLimiter(), log: () => undefined };
    const p = await createProduct(a.id, a1, validProduct());
    await setRaw(p.id, INVALID[0]![1]);
    const before = await storedText(p.id);
    await changeProductStatus(a.id, a1, p.id, "ACTIVE");
    await changeProductStatus(a.id, a1, p.id, "ARCHIVED");
    const m = await uploadMedia(a.id, a1, await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).jpeg().toBuffer(), deps);
    await attachProductImage(a.id, a1, p.id, m.id, deps);
    expect(await storedText(p.id)).toBe(before);
  });

  it("an edit that supplies no specs at all (the form's 'keep' choice) is a plain update; the form helper never sends specs unless asked", async () => {
    const fd = (entries: [string, string][]) => ({ get: (n: string) => entries.find(([k]) => k === n)?.[1] ?? null, getAll: (n: string) => entries.filter(([k]) => k === n).map(([, v]) => v) });
    expect(specsFromForm(fd([["specsIntent", "keep"], ["specLabel", "a"], ["specValue", "b"]]))).toBeUndefined();
    expect(specsFromForm(fd([["specLabel", "a"], ["specValue", "b"]]))).toBeUndefined(); // missing intent: nothing is written
    expect(specsFromForm(fd([["specsIntent", "CLEAR"]]))).toBeUndefined(); // forged/odd intent: nothing is written
  });

  it("the invalid value is reported (list flag and preview note) but is neither rendered nor repaired by reading", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ name: "یخچال" }));
    await changeProductStatus(a.id, a1, p.id, "ACTIVE");
    await setRaw(p.id, INVALID[1]![1]);
    const before = await storedText(p.id);
    const list = await listProducts(a.id, a1);
    expect(list.items.filter((i) => !analyzeSpecs(i.specs).ok).map((i) => i.id)).toEqual([p.id]);
    const { data, notes } = await getDraftPreview(a.id, a1);
    expect(notes.invalidSpecsProductCount).toBe(1);
    expect(data.products.find((x) => x.id === p.id)!.specs).toEqual([]);
    expect(await storedText(p.id)).toBe(before);
  });

  it("REPAIR is always an explicit action: clearing ([]) or replacing with valid rows works; invalid replacements are refused", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    await setRaw(p.id, INVALID[2]![1]);
    const before = await storedText(p.id);
    await expect(updateProduct(a.id, a1, p.id, { specs: [{ label: "", value: "x" }] })).rejects.toBeInstanceOf(ValidationError);
    expect(await storedText(p.id)).toBe(before);
    expect((await updateProduct(a.id, a1, p.id, { specs: GOOD })).specs).toEqual(GOOD); // explicit replacement
    await setRaw(p.id, INVALID[3]![1]);
    expect((await updateProduct(a.id, a1, p.id, { specs: [] })).specs).toEqual([]); // explicit clear (even though [] looks "empty")
    expect(analyzeSpecs((await getProduct(a.id, a1, p.id)).specs)).toEqual({ ok: true, rows: [] });
  });
});

describe("specs belong to the product: theme switching never touches them", () => {
  const productsJson = async (storeId: string) => JSON.stringify(await prisma.product.findMany({ where: { storeId }, orderBy: { id: "asc" } }));
  const go = async (ownerId: string, storeId: string, key: string) => switchTheme(ownerId, storeId, { targetKey: key, expectedDraftRevision: (await previewThemeSwitch(ownerId, storeId, key)).draftRevision });

  it("valid specs survive EVERY theme switch (rows byte-identical, and the draft preview carries them under each theme)", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ name: "ماشین لباسشویی", specs: GOOD }));
    await changeProductStatus(a.id, a1, p.id, "ACTIVE");
    const rows = await productsJson(a1);
    const text = await storedText(p.id);
    for (const key of ["coffee", "fashion", "appliances", "general", "appliances", "coffee", "general"]) {
      await go(a.id, a1, key);
      expect(await productsJson(a1), key).toBe(rows);
      expect(await storedText(p.id), key).toBe(text);
      const { data } = await getDraftPreview(a.id, a1);
      expect(data.template.key).toBe(key);
      expect(data.products[0]!.specs, key).toEqual(GOOD);
    }
  });

  it("INVALID stored specs also survive every theme switch untouched", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct());
    await setRaw(p.id, INVALID[0]![1]);
    const text = await storedText(p.id);
    for (const key of ["appliances", "fashion", "general"]) {
      await go(a.id, a1, key);
      expect(await storedText(p.id), key).toBe(text);
    }
  });

  it("specs are independent of the business category (changing it neither adds nor removes any)", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ specs: GOOD }));
    const { updateBusinessCategory } = await import("@/modules/stores/service");
    await updateBusinessCategory(a.id, a1, { businessCategory: "home-appliances", expected: "general" });
    await updateBusinessCategory(a.id, a1, { businessCategory: "coffee-food", expected: "home-appliances" });
    expect(analyzeSpecs((await getProduct(a.id, a1, p.id)).specs)).toEqual({ ok: true, rows: GOOD });
  });
});

describe("snapshots", () => {
  it("a schema-version-1 snapshot written BEFORE specs existed (products without a specs key) stays readable", async () => {
    const { a, a1 } = await twoTenants();
    const old = await createProduct(a.id, a1, validProduct({ name: "قدیمی" }));
    await changeProductStatus(a.id, a1, old.id, "ACTIVE");
    const { data } = await getDraftPreview(a.id, a1);
    const legacy = { ...data, products: data.products.map(({ specs: _s, ...rest }) => { void _s; return rest; }) };
    expect(legacy.products.every((p) => !("specs" in p))).toBe(true);
    const v = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: legacy as never } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });
    const read = await readPublishedStorefront(a1);
    expect(read).not.toBeNull();
    expect(read!.products.map((p) => p.specs)).toEqual([[]]);
  });

  it("a snapshot WITH specs round-trips through the same contract", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ specs: GOOD }));
    await changeProductStatus(a.id, a1, p.id, "ACTIVE");
    const { data } = await getDraftPreview(a.id, a1);
    const v = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: data as never } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });
    expect((await readPublishedStorefront(a1))!.products[0]!.specs).toEqual(GOOD);
  });
});

describe("worst-case size inside PostgreSQL", () => {
  it("maximum specs (30 rows x 40/120 three-byte characters) are accepted, and their stored text form stays within the documented budget", async () => {
    const { a, a1 } = await twoTenants();
    const worst = Array.from({ length: 30 }, (_, i) => ({ label: String.fromCodePoint(0x4e00 + i).repeat(40), value: String.fromCodePoint(0x4e00 + i).repeat(120) }));
    expect(specsInputSchema.safeParse(worst).success).toBe(true);
    const p = await createProduct(a.id, a1, validProduct({ specs: worst }));
    const n = (await prisma.$queryRaw<{ n: number }[]>`SELECT octet_length("specs"::text)::int AS n FROM "Product" WHERE id = ${p.id}`)[0]!.n;
    // PostgreSQL's text form adds a space after ':' and ',' (measured: 15,240 bytes); the application snapshot uses compact JSON (15,121 bytes).
    expect(n).toBeGreaterThanOrEqual(15_121);
    expect(n).toBeLessThanOrEqual(15_240);
  });
});
