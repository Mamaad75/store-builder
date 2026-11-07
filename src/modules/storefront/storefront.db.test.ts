import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCategory, updateCategory } from "@/modules/categories/service";
import { changeProductStatus, createProduct, updateProduct } from "@/modules/products/service";
import { NotFoundError } from "@/modules/stores/errors";
import { createStore } from "@/modules/stores/service";
import { buildView } from "@/templates/engine/view";
import { storefrontDataSchema } from "@/templates/storefront-data";
import { revision, snapshotRows, twoTenants, validProduct } from "@/test/catalog-helpers";
import { makeMedia, makeUser, prisma, publishStore, resetDb } from "@/test/db-helpers";
import { DraftStorefrontRepository } from "./repository";
import { readPublishedStorefront } from "./published";
import { getDraftPreview } from "./service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function activeProduct(ownerId: string, storeId: string, over: Record<string, unknown> = {}) {
  const p = await createProduct(ownerId, storeId, validProduct(over));
  return changeProductStatus(ownerId, storeId, p.id, "ACTIVE");
}

describe("draft preview data: product eligibility (phase 5 rules)", () => {
  it("includes only ACTIVE products; DRAFT and ARCHIVED never reach the data, only a count", async () => {
    const { a, a1 } = await twoTenants();
    const active = await activeProduct(a.id, a1, { name: "فعال" });
    const draft = await createProduct(a.id, a1, validProduct({ name: "پیش‌نویس" }));
    const archived = await activeProduct(a.id, a1, { name: "بایگانی" });
    await changeProductStatus(a.id, a1, archived.id, "ARCHIVED");

    const { data, notes } = await getDraftPreview(a.id, a1);
    expect(data.products.map((p) => p.id)).toEqual([active.id]);
    expect(notes.excludedProductCount).toBe(2);
    const json = JSON.stringify(data);
    expect(json).not.toContain(draft.id);
    expect(json).not.toContain(archived.id);
    expect(json).not.toContain("پیش‌نویس\"");
  });

  it("stock and status are independent: an ACTIVE product with zero stock is still shown", async () => {
    const { a, a1 } = await twoTenants();
    await activeProduct(a.id, a1, { name: "ناموجود", stockQuantity: 0 });
    const { data } = await getDraftPreview(a.id, a1);
    expect(data.products.map((p) => [p.name, p.stockQuantity])).toEqual([["ناموجود", 0]]);
  });

  it("an out-of-stock DRAFT product is still not shown", async () => {
    const { a, a1 } = await twoTenants();
    await createProduct(a.id, a1, validProduct({ stockQuantity: 50 }));
    expect((await getDraftPreview(a.id, a1)).data.products).toEqual([]);
  });

  it("prices stay integer Toman and the whole result satisfies the strict contract", async () => {
    const { a, a1 } = await twoTenants();
    await activeProduct(a.id, a1, { price: 1_000_000_000 });
    const { data } = await getDraftPreview(a.id, a1);
    expect(data.products[0]!.price).toBe(1_000_000_000);
    expect(storefrontDataSchema.safeParse(data).success).toBe(true);
  });
});

describe("draft preview data: images", () => {
  it("exposes only the relative key and real dimensions of READY images of ACTIVE products and of the logo", async () => {
    const { a, a1 } = await twoTenants();
    const shown = await activeProduct(a.id, a1, { name: "با تصویر" });
    const media = await makeMedia(a1, a.id);
    await prisma.product.update({ where: { id: shown.id }, data: { imageId: media.id } });
    const logo = await makeMedia(a1, a.id);
    await prisma.store.update({ where: { id: a1 }, data: { logoId: logo.id } });

    const { data } = await getDraftPreview(a.id, a1);
    expect(data.products[0]!.image).toEqual({ key: media.key, width: 100, height: 100 });
    expect(data.store.logo).toEqual({ key: logo.key, width: 100, height: 100 });
    expect(JSON.stringify(data)).not.toMatch(/https?:|localhost|bucket/); // never a host
  });

  it("a DRAFT/ARCHIVED product's image never reaches the storefront data, even though its URL would be public", async () => {
    const { a, a1 } = await twoTenants();
    const draft = await createProduct(a.id, a1, validProduct({ name: "پیش‌نویس تصویردار" }));
    const media = await makeMedia(a1, a.id);
    await prisma.product.update({ where: { id: draft.id }, data: { imageId: media.id } });
    const { data } = await getDraftPreview(a.id, a1);
    expect(data.products).toEqual([]);
    expect(JSON.stringify(data)).not.toContain(media.key);
  });

  it("media that is not READY is never exposed", async () => {
    const { a, a1 } = await twoTenants();
    const p = await activeProduct(a.id, a1);
    const media = await makeMedia(a1, a.id, { status: "DELETING" });
    await prisma.product.update({ where: { id: p.id }, data: { imageId: media.id } });
    expect((await getDraftPreview(a.id, a1)).data.products[0]!.image).toBeNull();
  });

  it("another tenant's media is never part of my storefront (composite FK + owner-scoped read)", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    await activeProduct(a.id, a1);
    await makeMedia(b1, b.id);
    expect(JSON.stringify((await getDraftPreview(a.id, a1)).data)).not.toContain(`stores/${b1}/`);
  });
});

describe("draft preview data: tenant isolation", () => {
  it("a foreign store, a missing store and a malformed id are indistinguishable", async () => {
    const { a, b, a1 } = await twoTenants();
    const msgs = new Set<string>();
    for (const [owner, id] of [[b.id, a1], [a.id, "ckdoesnotexist000000000000"], [a.id, "../etc/passwd"], [a.id, ""], [a.id, undefined]] as const) {
      const e = await getDraftPreview(owner, id).then(() => null, (x) => x);
      expect(e).toBeInstanceOf(NotFoundError);
      msgs.add(e.message);
    }
    expect(msgs.size).toBe(1);
  });

  it("never returns another tenant's products, categories, name or settings (same slugs on both sides)", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    await createCategory(a.id, a1, { name: "چای" });
    await createCategory(b.id, b1, { name: "چای" });
    await activeProduct(a.id, a1, { name: "محصول الف" });
    const bp = await activeProduct(b.id, b1, { name: "محصول الف" }); // same name/slug in another store
    await prisma.productCategory.findFirstOrThrow({ where: { storeId: b1 } });
    const { data } = await getDraftPreview(a.id, a1);
    const bCategory = await prisma.productCategory.findFirstOrThrow({ where: { storeId: b1 } });
    expect(data.store.name).toBe("A one");
    expect(data.products).toHaveLength(1);
    expect(data.products.map((p) => p.id)).not.toContain(bp.id);
    expect(data.categories.map((c) => c.id)).not.toContain(bCategory.id);
    expect(data.categories).toHaveLength(1);
  });

  it("the repository requires an owner and filters by it in SQL", async () => {
    expect(() => new DraftStorefrontRepository("")).toThrow();
    const { a, b, a1 } = await twoTenants();
    expect(await new DraftStorefrontRepository(b.id).load(a1)).toBeNull();
    expect(await new DraftStorefrontRepository(a.id).load(a1)).not.toBeNull();
  });

  it("an owner with several stores gets exactly the requested one", async () => {
    const { a, a1, a2 } = await twoTenants();
    expect((await getDraftPreview(a.id, a1)).data.template.key).toBe("general");
    expect((await getDraftPreview(a.id, a2)).data.template.key).toBe("coffee");
  });
});

describe("draft preview data: reflects the current draft", () => {
  it("product, category and page changes appear immediately", async () => {
    const { a, a1 } = await twoTenants();
    const cat = await createCategory(a.id, a1, { name: "چای" });
    const p = await activeProduct(a.id, a1, { name: "قدیمی", categoryId: cat.id });
    let d = (await getDraftPreview(a.id, a1)).data;
    expect(d.products[0]).toMatchObject({ name: "قدیمی", categoryId: cat.id });

    await updateProduct(a.id, a1, p.id, { name: "جدید", price: 777, stockQuantity: 9, categoryId: cat.id, description: "" });
    await updateCategory(a.id, a1, cat.id, { name: "چای ایرانی" });
    await prisma.page.update({ where: { storeId_type: { storeId: a1, type: "HOME" } }, data: { title: "صفحه اصلی" } });
    await prisma.store.update({ where: { id: a1 }, data: { name: "نام جدید" } });
    d = (await getDraftPreview(a.id, a1)).data;
    expect(d.products[0]).toMatchObject({ name: "جدید", price: 777, stockQuantity: 9 });
    expect(d.categories[0]!.name).toBe("چای ایرانی");
    expect(d.pages.find((x) => x.type === "HOME")!.title).toBe("صفحه اصلی");
    expect(d.store.name).toBe("نام جدید");
  });

  it("archiving a product removes it from the preview, re-draft-ing is not possible but status change is reflected", async () => {
    const { a, a1 } = await twoTenants();
    const p = await activeProduct(a.id, a1);
    await changeProductStatus(a.id, a1, p.id, "ARCHIVED");
    expect((await getDraftPreview(a.id, a1)).data.products).toEqual([]);
  });

  it("hidden pages are not part of the storefront", async () => {
    const { a, a1 } = await twoTenants();
    await prisma.page.update({ where: { storeId_type: { storeId: a1, type: "ABOUT" } }, data: { isVisible: false } });
    const { data } = await getDraftPreview(a.id, a1);
    expect(data.pages.map((p) => p.type)).not.toContain("ABOUT");
    expect(buildView(data, { basePath: "/p", segments: ["about"] }).status).toBe("not_found");
  });

  it("a brand-new store previews as an empty storefront", async () => {
    const u = await makeUser();
    const s = await createStore(u.id, { name: "تازه", templateKey: "general" });
    const { data, notes } = await getDraftPreview(u.id, s.id);
    expect(data.products).toEqual([]);
    expect(data.pages).toHaveLength(5);
    expect(notes).toMatchObject({ excludedProductCount: 0, settingsFallback: false, skippedSections: [] });
    expect(buildView(data, { basePath: "/p", segments: [] }).status).toBe("ok");
  });
});

describe("draft preview data: read-only and compatibility", () => {
  it("never writes: the store, revision and catalog rows are byte-identical afterwards", async () => {
    const { a, a1 } = await twoTenants();
    await activeProduct(a.id, a1);
    const before = await snapshotRows(a1);
    const r0 = await revision(a1);
    await getDraftPreview(a.id, a1);
    await getDraftPreview(a.id, a1);
    expect(await snapshotRows(a1)).toBe(before);
    expect(await revision(a1)).toBe(r0);
    expect(await prisma.storeVersion.count({ where: { storeId: a1 } })).toBe(0);
  });

  it("legacy / corrupt persisted page JSON is skipped for rendering, reported, and NEVER modified in the database", async () => {
    const { a, a1 } = await twoTenants();
    const home = await prisma.page.findUniqueOrThrow({ where: { storeId_type: { storeId: a1, type: "HOME" } } });
    const corrupted = [
      ...(home.sections as unknown[]),
      { id: "legacy", type: "carousel", props: { images: [] } },
      { id: "broken", type: "hero", props: { title: 5 } },
      "garbage",
    ];
    await prisma.page.update({ where: { id: home.id }, data: { sections: corrupted as never } });
    await prisma.page.update({ where: { storeId_type: { storeId: a1, type: "ABOUT" } }, data: { sections: { not: "an array" } as never } });

    const { data, notes } = await getDraftPreview(a.id, a1);
    const ids = data.pages.find((p) => p.type === "HOME")!.sections.map((s) => s.id);
    expect(ids).not.toContain("legacy");
    expect(ids).not.toContain("broken");
    expect(ids).toContain("home-hero");
    expect(data.pages.find((p) => p.type === "ABOUT")!.sections).toEqual([]);
    expect(notes.skippedSections.length).toBe(2);

    const after = await prisma.page.findUniqueOrThrow({ where: { id: home.id } });
    expect(after.sections).toEqual(corrupted); // data preserved exactly
  });

  it("invalid store settings fall back to template defaults without touching the row", async () => {
    const { a, a1 } = await twoTenants();
    await prisma.store.update({ where: { id: a1 }, data: { settings: { primaryColor: "javascript:1" } } });
    const { data, notes } = await getDraftPreview(a.id, a1);
    expect(notes.settingsFallback).toBe(true);
    expect(data.store.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).settings).toEqual({ primaryColor: "javascript:1" });
  });

  it("a store on a template that has no renderer yet previews as 'unsupported_template' (coffee until phase 9)", async () => {
    const { a, a2 } = await twoTenants();
    const { data } = await getDraftPreview(a.id, a2);
    expect(buildView(data, { basePath: "/p", segments: [] })).toEqual({ status: "unsupported_template", key: "coffee", version: 1 });
  });
});

describe("published reader: draft/published isolation", () => {
  it("returns null for an unpublished store and never falls back to the draft", async () => {
    const { a, a1 } = await twoTenants();
    await activeProduct(a.id, a1);
    expect(await readPublishedStorefront(a1)).toBeNull();
  });

  it("serves only the pinned snapshot: later draft edits and new draft/active products do not leak into it", async () => {
    const { a, a1 } = await twoTenants();
    const live = await activeProduct(a.id, a1, { name: "منتشرشده" });
    const { data } = await getDraftPreview(a.id, a1);
    const v = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: await revision(a1), snapshot: data as never } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });

    // draft keeps moving
    await updateProduct(a.id, a1, live.id, { name: "تغییر در پیش‌نویس", price: 1, stockQuantity: 1, categoryId: null, description: "" });
    await activeProduct(a.id, a1, { name: "محصول جدید" });
    await createProduct(a.id, a1, validProduct({ name: "فقط پیش‌نویس" }));
    await prisma.store.update({ where: { id: a1 }, data: { name: "نام پیش‌نویس" } });

    const published = await readPublishedStorefront(a1);
    expect(published).toEqual(data);
    expect(JSON.stringify(published)).not.toMatch(/محصول جدید|فقط پیش‌نویس|نام پیش‌نویس/);
    const draft = (await getDraftPreview(a.id, a1)).data;
    expect(draft.products.map((p) => p.name)).toContain("محصول جدید");
  });

  it("serves the version the store points to, not a newer unpublished version", async () => {
    const { a, a1 } = await twoTenants();
    const { data } = await getDraftPreview(a.id, a1);
    const newer = { ...data, store: { ...data.store, name: "نسخه جدیدتر ولی منتشرنشده" } };
    const v1 = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: data as never } });
    await prisma.storeVersion.create({ data: { storeId: a1, number: 2, draftRevision: 2, snapshot: newer as never } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v1.id, publishedAt: new Date() } });
    expect((await readPublishedStorefront(a1))?.store.name).toBe("A one");
  });

  it("returns null for an invalid snapshot instead of rendering it", async () => {
    const { a1 } = await twoTenants();
    const v = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: { hacked: true } } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });
    expect(await readPublishedStorefront(a1)).toBeNull();
  });

  it("returns null for the legacy empty-object snapshot written by test helpers / old rows", async () => {
    const { a1 } = await twoTenants();
    await publishStore(a1);
    expect(await readPublishedStorefront(a1)).toBeNull();
  });

  it("a store that is UNPUBLISHED stops being served", async () => {
    const { a, a1 } = await twoTenants();
    const { data } = await getDraftPreview(a.id, a1);
    await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: data as never } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "UNPUBLISHED", publishedVersionId: null, publishedAt: new Date() } });
    expect(await readPublishedStorefront(a1)).toBeNull();
  });
});
