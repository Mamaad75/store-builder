import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeMedia, makeStore, makeUser, prisma, publishStore, resetDb } from "./db-helpers";
import { seedTemplates } from "../../prisma/seed";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("template seed", () => {
  it("creates exactly the four agreed templates at version 1", async () => {
    const t = await prisma.template.findMany({ include: { versions: true }, orderBy: { key: "asc" } });
    expect(t.map((x) => x.key)).toEqual(["appliances", "coffee", "fashion", "general"]);
    expect(t.every((x) => x.versions.length === 1 && x.versions[0]!.version === 1)).toBe(true);
  });
  it("is idempotent and never overwrites an existing version", async () => {
    const v = await prisma.templateVersion.findFirstOrThrow({ where: { template: { key: "coffee" } } });
    await prisma.templateVersion.update({ where: { id: v.id }, data: { defaultSettings: { custom: true } } });
    await seedTemplates(prisma);
    expect(await prisma.templateVersion.count()).toBe(4);
    const after = await prisma.templateVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.defaultSettings).toEqual({ custom: true });
  });
  it("supports adding a new version of a template", async () => {
    const t = await prisma.template.findUniqueOrThrow({ where: { key: "coffee" } });
    await prisma.templateVersion.create({ data: { templateId: t.id, version: 2, defaultSettings: {}, defaultPages: [] } });
    await expect(
      prisma.templateVersion.create({ data: { templateId: t.id, version: 2, defaultSettings: {}, defaultPages: [] } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("ownership and uniqueness", () => {
  it("enforces unique user email", async () => {
    await prisma.user.create({ data: { email: "a@b.com", name: "a", passwordHash: "x" } });
    await expect(prisma.user.create({ data: { email: "a@b.com", name: "b", passwordHash: "x" } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("rejects a store with a non-existent owner", async () => {
    const tv = await prisma.templateVersion.findFirstOrThrow();
    await expect(
      prisma.store.create({ data: { ownerId: "nope", templateVersionId: tv.id, name: "x", settings: {} } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
  it("restricts deleting a user who owns stores, and a template version in use", async () => {
    const u = await makeUser();
    const s = await makeStore(u.id);
    await expect(prisma.user.delete({ where: { id: u.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.templateVersion.delete({ where: { id: s.templateVersionId } })).rejects.toMatchObject({ code: "P2003" });
  });
  it("slugs are unique per store but reusable across stores", async () => {
    const u = await makeUser();
    const a = await makeStore(u.id, "A");
    const b = await makeStore(u.id, "B");
    const page = { type: "HOME", title: "t", slug: "home", sections: [] } as const;
    await prisma.page.create({ data: { storeId: a.id, ...page } });
    await prisma.page.create({ data: { storeId: b.id, ...page } });
    await expect(prisma.page.create({ data: { storeId: a.id, ...page } })).rejects.toMatchObject({ code: "P2002" });
    await prisma.product.create({ data: { storeId: a.id, name: "p", slug: "p", price: 1 } });
    await prisma.product.create({ data: { storeId: b.id, name: "p", slug: "p", price: 1 } });
    await expect(prisma.product.create({ data: { storeId: a.id, name: "p2", slug: "p", price: 1 } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("rejects negative prices", async () => {
    const u = await makeUser();
    const s = await makeStore(u.id);
    await expect(prisma.product.create({ data: { storeId: s.id, name: "p", slug: "p", price: -1 } })).rejects.toThrow();
  });
});

describe("subdomains", () => {
  it("are globally unique", async () => {
    const u = await makeUser();
    const a = await makeStore(u.id, "A");
    const b = await makeStore(u.id, "B");
    await prisma.domain.create({ data: { storeId: a.id, kind: "SUBDOMAIN", host: "coffee" } });
    await expect(prisma.domain.create({ data: { storeId: b.id, kind: "SUBDOMAIN", host: "coffee" } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("allow at most one subdomain per store", async () => {
    const u = await makeUser();
    const a = await makeStore(u.id);
    await prisma.domain.create({ data: { storeId: a.id, kind: "SUBDOMAIN", host: "one" } });
    await expect(prisma.domain.create({ data: { storeId: a.id, kind: "SUBDOMAIN", host: "two" } })).rejects.toThrow();
    await prisma.domain.create({ data: { storeId: a.id, kind: "CUSTOM", host: "shop.example.org" } });
  });
});

describe("cross-tenant integrity (composite foreign keys)", () => {
  it("rejects a product pointing at another store's category or media", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const s1 = await makeStore(u1.id);
    const s2 = await makeStore(u2.id);
    const cat2 = await prisma.productCategory.create({ data: { storeId: s2.id, name: "c", slug: "c" } });
    const media2 = await makeMedia(s2.id, u2.id);
    await expect(
      prisma.product.create({ data: { storeId: s1.id, name: "p", slug: "p", price: 1, categoryId: cat2.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.product.create({ data: { storeId: s1.id, name: "p", slug: "p", price: 1, imageId: media2.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    // same-store references are fine
    await prisma.product.create({ data: { storeId: s2.id, name: "p", slug: "p", price: 1, categoryId: cat2.id, imageId: media2.id } });
  });
  it("rejects a store pointing at another store's published version", async () => {
    const u = await makeUser();
    const s1 = await makeStore(u.id, "A");
    const s2 = await makeStore(u.id, "B");
    const v2 = await prisma.storeVersion.create({ data: { storeId: s2.id, number: 1, draftRevision: 1, snapshot: {} } });
    await expect(
      prisma.store.update({ where: { id: s1.id }, data: { status: "PUBLISHED", publishedVersionId: v2.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
  it("keeps status and publishedVersionId consistent", async () => {
    const u = await makeUser();
    const s = await makeStore(u.id);
    await expect(prisma.store.update({ where: { id: s.id }, data: { status: "PUBLISHED" } })).rejects.toThrow();
    const published = await publishStore(s.id);
    expect(published.status).toBe("PUBLISHED");
    await expect(prisma.store.update({ where: { id: s.id }, data: { status: "UNPUBLISHED" } })).rejects.toThrow();
    const off = await prisma.store.update({ where: { id: s.id }, data: { status: "UNPUBLISHED", publishedVersionId: null } });
    expect(off.publishedVersionId).toBeNull();
    expect(await prisma.storeVersion.count({ where: { storeId: s.id } })).toBe(1); // version kept for republish
  });
});

describe("deletion rules", () => {
  it("restricts deleting a category or media in use, allows it after detaching", async () => {
    const u = await makeUser();
    const s = await makeStore(u.id);
    const cat = await prisma.productCategory.create({ data: { storeId: s.id, name: "c", slug: "c" } });
    const media = await makeMedia(s.id, u.id);
    const p = await prisma.product.create({ data: { storeId: s.id, name: "p", slug: "p", price: 1, categoryId: cat.id, imageId: media.id } });
    await expect(prisma.productCategory.delete({ where: { id: cat.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.media.delete({ where: { id: media.id } })).rejects.toMatchObject({ code: "P2003" });
    await prisma.product.update({ where: { id: p.id }, data: { categoryId: null, imageId: null } });
    await prisma.productCategory.delete({ where: { id: cat.id } });
    await prisma.media.delete({ where: { id: media.id } });
  });
  it("deleting a published store cascades to all of its data and leaves other stores intact", async () => {
    const u = await makeUser();
    const s = await makeStore(u.id, "A");
    const other = await makeStore(u.id, "B");
    const cat = await prisma.productCategory.create({ data: { storeId: s.id, name: "c", slug: "c" } });
    const media = await makeMedia(s.id, u.id);
    await prisma.product.create({ data: { storeId: s.id, name: "p", slug: "p", price: 1, categoryId: cat.id, imageId: media.id } });
    await prisma.page.create({ data: { storeId: s.id, type: "HOME", title: "t", slug: "home", sections: [] } });
    await prisma.domain.create({ data: { storeId: s.id, kind: "SUBDOMAIN", host: "gone" } });
    await publishStore(s.id);
    await prisma.product.create({ data: { storeId: other.id, name: "keep", slug: "keep", price: 1 } });

    await prisma.store.delete({ where: { id: s.id } });

    for (const m of ["product", "productCategory", "media", "page", "domain", "storeVersion"] as const) {
      // @ts-expect-error dynamic delegate access for a compact assertion
      expect(await prisma[m].count({ where: { storeId: s.id } })).toBe(0);
    }
    expect(await prisma.product.count({ where: { storeId: other.id } })).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });
});
