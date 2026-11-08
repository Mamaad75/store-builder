import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_CATEGORIES } from "@/lib/business-categories";
import { createCategory } from "@/modules/categories/service";
import { createProduct } from "@/modules/products/service";
import { getDraftPreview } from "@/modules/storefront/service";
import { allThemes } from "@/templates/theme-catalog";
import { revision, snapshotRows, validProduct } from "@/test/catalog-helpers";
import { makeUnregisteredThemeStore, makeUser, prisma, resetDb } from "@/test/db-helpers";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { createStore, listActiveTemplates, updateBusinessCategory, updateStore } from "./service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const cat = (id: string) => prisma.store.findUniqueOrThrow({ where: { id }, select: { businessCategory: true, draftRevision: true, settings: true, updatedAt: true } });
const homeHero = async (id: string) => {
  const home = await prisma.page.findFirstOrThrow({ where: { storeId: id, type: "HOME" } });
  return (home.sections as { type: string; props: { title: string } }[]).find((s) => s.type === "hero")!.props.title;
};

describe("creation: business category and theme are independent choices", () => {
  const THEMES = allThemes().map((t) => t.key);

  it.each(BUSINESS_CATEGORIES.flatMap((c) => THEMES.map((t) => [c.key, t] as const)))("category %s with theme %s: stored separately, starter text from the CATEGORY, structure from the THEME", async (category, theme) => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "فروشگاه", templateKey: theme, businessCategory: category });
    const s = await prisma.store.findUniqueOrThrow({ where: { id }, include: { templateVersion: { include: { template: true } } } });
    expect(s.businessCategory).toBe(category);
    expect(s.templateVersion.template.key).toBe(theme);
    expect(await homeHero(id)).toBe(BUSINESS_CATEGORIES.find((c) => c.key === category)!.starter.heroTitle);
    // the page structure (section ids and types) is exactly the theme's default structure
    const seed = (s.templateVersion.defaultPages as { type: string; sections: { id: string; type: string }[] }[]).map((p) => [p.type, p.sections.map((x) => `${x.id}:${x.type}`)]);
    const pages = await prisma.page.findMany({ where: { storeId: id }, orderBy: { position: "asc" } });
    expect(pages.map((p) => [p.type, (p.sections as { id: string; type: string }[]).map((x) => `${x.id}:${x.type}`)])).toEqual(seed);
    // and the result is previewable with that theme
    expect((await getDraftPreview(u.id, id)).data.template.key).toBe(theme);
  });

  it("without a category, a best-effort one is inferred from the theme (coffee -> coffee-food, fashion -> fashion, else general)", async () => {
    const u = await makeUser();
    const got: Record<string, string> = {};
    for (const t of THEMES) got[t] = (await cat((await createStore(u.id, { name: t, templateKey: t })).id)).businessCategory;
    expect(got).toEqual({ general: "general", coffee: "coffee-food", fashion: "fashion", appliances: "home-appliances" });
  });

  it("rejects unknown or malformed categories and creates nothing", async () => {
    const u = await makeUser();
    for (const businessCategory of ["pets", "Coffee-Food", "", "a b", "x".repeat(41), "../x"]) {
      await expect(createStore(u.id, { name: "x", templateKey: "general", businessCategory }), businessCategory).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await prisma.store.count()).toBe(0);
  });

  it("a theme that exists in the database but not in code cannot be used for a new store", async () => {
    const u = await makeUser();
    await makeUnregisteredThemeStore(u.id); // creates the legacy-demo template rows
    await prisma.store.deleteMany();
    await expect(createStore(u.id, { name: "x", templateKey: "legacy-demo" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.store.count()).toBe(0);
  });

  it("the theme list offers registered themes (catalog order, theme metadata names) and hides unregistered or inactive ones", async () => {
    await makeUser();
    const t = await prisma.template.upsert({ where: { key: "legacy-demo" }, create: { key: "legacy-demo", name: "x" }, update: {} });
    await prisma.templateVersion.create({ data: { templateId: t.id, version: 1, defaultSettings: {}, defaultPages: [] } });
    expect((await listActiveTemplates()).map((x) => x.key)).toEqual(["general", "coffee", "fashion", "appliances"]);
    expect((await listActiveTemplates())[1]!.name).toBe("گرم و ادیتوریال");
    await prisma.template.update({ where: { key: "coffee" }, data: { isActive: false } });
    expect((await listActiveTemplates()).map((x) => x.key)).toEqual(["general", "fashion", "appliances"]);
  });
});

describe("changing the category is metadata only", () => {
  async function richStore() {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "فروشگاه", templateKey: "coffee", businessCategory: "coffee-food" });
    await updateStore(u.id, id, { primaryColor: "#123456", typography: { sizeScale: "large", headingWeight: "600" } });
    await createCategory(u.id, id, { name: "چای" });
    await createProduct(u.id, id, validProduct());
    return { u, id };
  }

  it("changes only the label: pages, sections, products, categories, settings, colors, typography and draftRevision stay identical", async () => {
    const { u, id } = await richStore();
    const before = { rows: await snapshotRows(id), pages: JSON.stringify(await prisma.page.findMany({ where: { storeId: id }, orderBy: { type: "asc" } })), rev: await revision(id), hero: await homeHero(id) };
    const r = await updateBusinessCategory(u.id, id, { businessCategory: "home-appliances", expected: "coffee-food" });
    expect(r).toEqual({ businessCategory: "home-appliances", changed: true });

    const s = await cat(id);
    expect(s.businessCategory).toBe("home-appliances");
    expect(s.draftRevision).toBe(before.rev); // metadata: no draft revision bump
    expect(JSON.stringify(await prisma.page.findMany({ where: { storeId: id }, orderBy: { type: "asc" } }))).toBe(before.pages);
    expect(await homeHero(id)).toBe(before.hero); // the new category's starter text is NOT applied
    expect(await homeHero(id)).toBe(BUSINESS_CATEGORIES.find((c) => c.key === "coffee-food")!.starter.heroTitle);
    // everything in the shared snapshot except the label itself (and updatedAt) is identical
    const strip = (j: string) => JSON.stringify({ ...JSON.parse(j), store: { ...JSON.parse(j).store, businessCategory: undefined, updatedAt: undefined } });
    expect(strip(await snapshotRows(id))).toBe(strip(before.rows));
    expect((s.settings as { primaryColor: string; typography: { sizeScale: string } }).primaryColor).toBe("#123456");
    expect((s.settings as { typography: { sizeScale: string } }).typography.sizeScale).toBe("large");
  });

  it("is invisible to the renderer: the storefront data contains no category and is identical before and after", async () => {
    const { u, id } = await richStore();
    const before = JSON.stringify((await getDraftPreview(u.id, id)).data);
    await updateBusinessCategory(u.id, id, { businessCategory: "fashion", expected: "coffee-food" });
    expect(JSON.stringify((await getDraftPreview(u.id, id)).data)).toBe(before);
    expect(before).not.toMatch(/coffee-food|businessCategory|home-appliances/);
  });

  it("a no-op (same value) writes nothing", async () => {
    const { u, id } = await richStore();
    const before = await cat(id);
    expect(await updateBusinessCategory(u.id, id, { businessCategory: "coffee-food", expected: "coffee-food" })).toEqual({ businessCategory: "coffee-food", changed: false });
    expect((await cat(id)).updatedAt).toEqual(before.updatedAt);
  });

  it("explicit conflicts: a stale expected value is rejected and nothing changes; two simultaneous changes cannot both win", async () => {
    const { u, id } = await richStore();
    await updateBusinessCategory(u.id, id, { businessCategory: "fashion", expected: "coffee-food" });
    await expect(updateBusinessCategory(u.id, id, { businessCategory: "general", expected: "coffee-food" })).rejects.toBeInstanceOf(ConflictError);
    expect((await cat(id)).businessCategory).toBe("fashion");

    const results = await Promise.allSettled(["general", "home-appliances", "coffee-food"].map((c) => updateBusinessCategory(u.id, id, { businessCategory: c, expected: "fashion" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof ConflictError)).toBe(true);
  });

  it("ownership is part of the atomic statement: foreign, missing and malformed stores are the same NotFoundError and nothing changes", async () => {
    const { id } = await richStore();
    const other = await makeUser();
    const before = await cat(id);
    for (const [owner, store] of [[other.id, id], [other.id, "ckdoesnotexist000000000000"], [other.id, "../x"]] as const) {
      await expect(updateBusinessCategory(owner, store, { businessCategory: "fashion", expected: "coffee-food" })).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await cat(id)).toEqual(before);
  });

  it("only registered categories are accepted by the application; strict input (no extra keys)", async () => {
    const { u, id } = await richStore();
    for (const bad of [{ businessCategory: "pets", expected: "coffee-food" }, { businessCategory: "Fashion", expected: "coffee-food" }, { businessCategory: "fashion", expected: "coffee-food", ownerId: "x" }, { businessCategory: "fashion" }]) {
      await expect(updateBusinessCategory(u.id, id, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await cat(id)).businessCategory).toBe("coffee-food");
  });
});

describe("database rule: the CHECK validates the key FORMAT only (adding a category needs no migration)", () => {
  it("accepts any well-formed key (even one the application does not know yet) and rejects malformed ones", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "x", templateKey: "general" });
    await expect(prisma.store.update({ where: { id }, data: { businessCategory: "pet-supplies" } })).resolves.toBeTruthy(); // not in the registry, valid format
    for (const bad of ["Pet", "1abc", "a b", "", "a".repeat(41), "a_b", "-a"]) {
      await expect(prisma.store.update({ where: { id }, data: { businessCategory: bad } }), bad).rejects.toThrow();
    }
  });

  it("a store whose stored category is unknown to the registry still renders and edits normally, and the owner can change it", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "x", templateKey: "general" });
    await prisma.store.update({ where: { id }, data: { businessCategory: "pet-supplies" } });
    expect((await getDraftPreview(u.id, id)).data.store.name).toBe("x");
    await expect(updateBusinessCategory(u.id, id, { businessCategory: "general", expected: "pet-supplies" })).resolves.toMatchObject({ changed: true });
  });

  it("stores created without a category value (legacy rows / direct inserts) default to general", async () => {
    const u = await makeUser();
    const tv = await prisma.templateVersion.findFirstOrThrow({ where: { template: { key: "coffee" } } });
    const s = await prisma.store.create({ data: { ownerId: u.id, templateVersionId: tv.id, name: "legacy", settings: {} } });
    expect(s.businessCategory).toBe("general");
  });
});
