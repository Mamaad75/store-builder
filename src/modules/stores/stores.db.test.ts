import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeUser, prisma, resetDb } from "@/test/db-helpers";
import { NotFoundError, StoreLimitError, ValidationError } from "./errors";
import { StoreRepository } from "./repository";
import { coffeeTheme } from "@/templates/coffee/definition";
import { setExtraThemesForTests } from "@/templates/theme-catalog";
import { createStore, deleteStore, getStore, listStores, updateStore } from "./service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function twoUsersWithStores() {
  const a = await makeUser();
  const b = await makeUser();
  const a1 = await createStore(a.id, { name: "A one", templateKey: "coffee" });
  const a2 = await createStore(a.id, { name: "A two", templateKey: "fashion" });
  const b1 = await createStore(b.id, { name: "B one", templateKey: "general" });
  const b2 = await createStore(b.id, { name: "B two", templateKey: "coffee" });
  return { a, b, a1: a1.id, a2: a2.id, b1: b1.id, b2: b2.id };
}

async function snapshotStore(id: string) {
  const s = await prisma.store.findUnique({ where: { id }, include: { pages: true } });
  return JSON.stringify(s);
}

describe("createStore", () => {
  it("creates a draft store owned by the caller with the latest template version and 5 default pages", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: " My Shop ", templateKey: "coffee" });
    const s = await prisma.store.findUniqueOrThrow({ where: { id }, include: { pages: true, templateVersion: { include: { template: true } } } });
    expect(s).toMatchObject({ ownerId: u.id, name: "My Shop", status: "DRAFT", publishedVersionId: null, draftRevision: 1 });
    expect(s.templateVersion.template.key).toBe("coffee");
    expect(s.pages.map((p) => p.type).sort()).toEqual(["ABOUT", "CONTACT", "HOME", "PRODUCTS", "PRODUCT_DETAIL"]);
  });
  it("uses the newest active template version and ignores inactive ones", async () => {
    const u = await makeUser();
    const t = await prisma.template.findUniqueOrThrow({ where: { key: "coffee" } });
    const v1 = await prisma.templateVersion.findFirstOrThrow({ where: { templateId: t.id } });
    await prisma.templateVersion.create({ data: { templateId: t.id, version: 2, defaultSettings: v1.defaultSettings!, defaultPages: v1.defaultPages! } });
    await prisma.templateVersion.create({ data: { templateId: t.id, version: 3, isActive: false, defaultSettings: v1.defaultSettings!, defaultPages: v1.defaultPages! } });
    // a version must also exist in code (a store is never created on a theme that cannot be shown): register coffee@2 for this test
    setExtraThemesForTests([{ ...coffeeTheme, version: 2 }]);
    try {
      const { id } = await createStore(u.id, { name: "x", templateKey: "coffee" });
      const s = await prisma.store.findUniqueOrThrow({ where: { id }, include: { templateVersion: true } });
      expect(s.templateVersion.version).toBe(2);
    } finally {
      setExtraThemesForTests([]);
    }
  });
  it("rejects unknown templates and mass-assigned fields, creating nothing", async () => {
    const u = await makeUser();
    await expect(createStore(u.id, { name: "x", templateKey: "nope" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createStore(u.id, { name: "x", templateKey: "coffee", ownerId: "other" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createStore(u.id, { name: "x", templateKey: "coffee", status: "PUBLISHED" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.store.count()).toBe(0);
  });
  it("enforces the 10-store limit, including under concurrency, per user", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, (_, i) => createStore(u.id, { name: `s${i}`, templateKey: "general" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(5);
    expect(rejected.every((r) => r.reason instanceof StoreLimitError)).toBe(true);
    expect(await prisma.store.count({ where: { ownerId: u.id } })).toBe(10);
    await createStore(other.id, { name: "other", templateKey: "general" }); // limit is per user
  });
});

describe("tenant isolation: User A cannot touch User B's stores", () => {
  it("list returns only the caller's stores", async () => {
    const { a, b, a1, a2, b1, b2 } = await twoUsersWithStores();
    expect((await listStores(a.id)).map((s) => s.id).sort()).toEqual([a1, a2].sort());
    expect((await listStores(b.id)).map((s) => s.id).sort()).toEqual([b1, b2].sort());
    expect((await listStores(a.id)).some((s) => JSON.stringify(s).includes(b.id))).toBe(false);
  });

  it("get: foreign and non-existent ids are indistinguishable (NotFoundError)", async () => {
    const { a, b1 } = await twoUsersWithStores();
    const foreign = await getStore(a.id, b1).catch((e) => e);
    const missing = await getStore(a.id, "does-not-exist").catch((e) => e);
    expect(foreign).toBeInstanceOf(NotFoundError);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect(foreign.message).toBe(missing.message);
    expect(foreign.name).toBe(missing.name);
    for (const bad of [undefined, null, 5, {}, [], "", "x".repeat(500)]) {
      await expect(getStore(a.id, bad)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("update: fails with NotFoundError and leaves B's store byte-for-byte unchanged", async () => {
    const { a, b1 } = await twoUsersWithStores();
    const before = await snapshotStore(b1);
    const err = await updateStore(a.id, b1, { name: "pwned", primaryColor: "#ff0000", contact: { phone: "123" } }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(await snapshotStore(b1)).toBe(before);
    const missing = await updateStore(a.id, "nope", { name: "x" }).catch((e) => e);
    expect(missing.name).toBe(err.name);
    expect(missing.message).toBe(err.message);
  });

  it("delete: fails with NotFoundError even with the exact store name, and B's store survives", async () => {
    const { a, b1 } = await twoUsersWithStores();
    const before = await snapshotStore(b1);
    await expect(deleteStore(a.id, b1, "B one")).rejects.toBeInstanceOf(NotFoundError);
    expect(await snapshotStore(b1)).toBe(before);
    expect(await prisma.store.count()).toBe(4);
  });

  it("repository methods are all owner-bound (direct repository misuse cannot cross tenants)", async () => {
    const { a, b1 } = await twoUsersWithStores();
    const repo = new StoreRepository(a.id);
    expect(await repo.find(b1)).toBeNull();
    expect(await repo.updateDraft(b1, 1, { name: "x", settings: {} })).toBe(false);
    expect(await repo.deleteConfirmed(b1, "B one")).toBe(false);
    expect(await prisma.store.count({ where: { id: b1 } })).toBe(1);
    expect(() => new StoreRepository("")).toThrow();
  });

  it("an owner id that is the other user's id for a different resource type still cannot cross (ids from the wrong user)", async () => {
    const { a, b, a1 } = await twoUsersWithStores();
    // B tries to use A's store id; A's data stays intact.
    await expect(updateStore(b.id, a1, { name: "pwned" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteStore(b.id, a1, "A one")).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).name).toBe("A one");
    expect(a.id).not.toBe(b.id);
  });
});

describe("updateStore (owner)", () => {
  it("updates only whitelisted draft fields, merges settings, and bumps draftRevision", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "Shop", templateKey: "coffee" });
    const updated = await updateStore(u.id, id, { name: "New", primaryColor: "#112233", contact: { phone: "0912" }, social: { instagram: "shop_ig" } });
    expect(updated.name).toBe("New");
    expect(updated.draftRevision).toBe(2);
    expect(updated.settings).toMatchObject({ primaryColor: "#112233", direction: "rtl", contact: { phone: "0912", email: "", address: "" }, social: { instagram: "shop_ig", telegram: "" } });
    const row = await prisma.store.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ ownerId: u.id, status: "DRAFT", publishedVersionId: null });
  });
  it("rejects mass-assignment (ownerId/status/publishedVersionId/templateVersionId) without changing anything", async () => {
    const { a, b, a1 } = await twoUsersWithStores();
    const before = await snapshotStore(a1);
    for (const extra of [{ ownerId: b.id }, { status: "PUBLISHED" }, { publishedVersionId: "x" }, { templateVersionId: "x" }, { draftRevision: 99 }]) {
      await expect(updateStore(a.id, a1, { name: "ok", ...extra })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await snapshotStore(a1)).toBe(before);
  });
  it("concurrent updates never lose the revision counter", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "Shop", templateKey: "coffee" });
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => updateStore(u.id, id, { contact: { phone: String(i) } })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBeGreaterThan(0);
    expect((await prisma.store.findUniqueOrThrow({ where: { id } })).draftRevision).toBe(1 + ok);
  });
});

describe("deleteStore (owner)", () => {
  it("requires the exact store name; a wrong or missing name deletes nothing", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "My Shop", templateKey: "coffee" });
    for (const typed of ["my shop", "My", "", undefined, null, 5]) {
      await expect(deleteStore(u.id, id, typed)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await prisma.store.count({ where: { id } })).toBe(1);
    await deleteStore(u.id, id, " My Shop ");
    expect(await prisma.store.count({ where: { id } })).toBe(0);
  });
  it("physically deletes the store with its pages, products, categories, media and versions; other stores survive", async () => {
    const { a, a1, a2 } = await twoUsersWithStores();
    const cat = await prisma.productCategory.create({ data: { storeId: a1, name: "c", slug: "c" } });
    const media = await prisma.media.create({ data: { storeId: a1, uploadedById: a.id, key: `stores/${a1}/${"0".repeat(32)}.webp`, mimeType: "image/webp", sizeBytes: 5 } });
    await prisma.product.create({ data: { storeId: a1, name: "p", slug: "p", price: 100, categoryId: cat.id, imageId: media.id } });
    await prisma.domain.create({ data: { storeId: a1, kind: "SUBDOMAIN", host: "gone" } });
    const v = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: {} } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v.id } });

    await deleteStore(a.id, a1, "A one");

    for (const m of ["page", "product", "productCategory", "media", "domain", "storeVersion"] as const) {
      // @ts-expect-error dynamic delegate for a compact assertion
      expect(await prisma[m].count({ where: { storeId: a1 } })).toBe(0);
    }
    expect(await prisma.store.count({ where: { id: a2 } })).toBe(1);
    expect(await prisma.page.count({ where: { storeId: a2 } })).toBe(5);
    expect(await prisma.store.count()).toBe(3);
  });
  it("a second delete of the same store is a NotFoundError", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "S", templateKey: "coffee" });
    await deleteStore(u.id, id, "S");
    await expect(deleteStore(u.id, id, "S")).rejects.toBeInstanceOf(NotFoundError);
  });
});
