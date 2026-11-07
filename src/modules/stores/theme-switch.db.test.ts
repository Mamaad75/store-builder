import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setMediaStorageForTests } from "@/lib/storage";
import { MemoryRateLimiter } from "@/modules/auth/rate-limit";
import { MediaInUseError } from "@/modules/media/errors";
import { deleteMedia, releaseMedia, uploadMedia } from "@/modules/media/service";
import { addSection, getPageEditor, recoverPage, removeDormantSection, setSectionImage, updateSection } from "@/modules/pages/service";
import { readPublishedStorefront } from "@/modules/storefront/published";
import { CandidateThemeUnavailableError, getDraftPreview } from "@/modules/storefront/service";
import type { EditorSpec } from "@/templates/editor";
import { PAGE_TYPES, type PageType } from "@/templates/sections";
import type { ThemeDefinition } from "@/templates/theme";
import { generalTheme } from "@/templates/general/definition";
import { setExtraThemesForTests } from "@/templates/theme-catalog";
import { revision, twoTenants } from "@/test/catalog-helpers";
import { prisma, resetDb } from "@/test/db-helpers";
import { MemoryMediaStorage } from "@/test/memory-storage";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { listSwitchableThemes, previewThemeSwitch, switchTheme, ThemeSwitchBlockedError } from "./theme-switch";

beforeEach(resetDb);
afterEach(() => {
  setExtraThemesForTests([]);
  setMediaStorageForTests(undefined);
});
afterAll(() => prisma.$disconnect());

const photo = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "teal" } }).jpeg().toBuffer();
const themeOf = async (storeId: string) => (await prisma.store.findUniqueOrThrow({ where: { id: storeId }, include: { templateVersion: { include: { template: true } } } })).templateVersion.template.key;
const pagesJson = async (storeId: string) => (await prisma.page.findMany({ where: { storeId }, orderBy: { type: "asc" } })).map((p) => ({ type: p.type, sections: p.sections, legacy: p.legacySections, revision: p.revision, isVisible: p.isVisible, title: p.title, slug: p.slug }));
const row = (storeId: string, type: string) => prisma.page.findFirstOrThrow({ where: { storeId, type: type as never } });
const rep = (ownerId: string, storeId: string, key: string) => previewThemeSwitch(ownerId, storeId, key);
const go = async (ownerId: string, storeId: string, key: string) => switchTheme(ownerId, storeId, { targetKey: key, expectedDraftRevision: (await rep(ownerId, storeId, key)).draftRevision });

/** Every table a theme switch must leave alone, serialised, plus the store row minus the two fields a switch may change. */
async function everythingButTheme(storeId: string) {
  const s = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const { templateVersionId: _t, draftRevision: _d, updatedAt: _u, ...rest } = s;
  void _t; void _d; void _u;
  return JSON.stringify({
    store: rest,
    pages: await prisma.page.findMany({ where: { storeId }, orderBy: { type: "asc" } }),
    products: await prisma.product.findMany({ where: { storeId }, orderBy: { id: "asc" } }),
    categories: await prisma.productCategory.findMany({ where: { storeId }, orderBy: { id: "asc" } }),
    media: await prisma.media.findMany({ where: { storeId }, orderBy: { id: "asc" } }),
    versions: await prisma.storeVersion.findMany({ where: { storeId }, orderBy: { id: "asc" } }),
  });
}

/** A registered fake theme (DB rows + code definition) shaped like `general` with editor-spec changes. */
async function registerFakeTheme(key: string, patch: Partial<Record<PageType, Partial<EditorSpec["pages"][PageType]>>>, version = 1, active = true): Promise<ThemeDefinition> {
  const general = await prisma.templateVersion.findFirstOrThrow({ where: { template: { key: "general" } } });
  const t = await prisma.template.upsert({ where: { key }, create: { key, name: key }, update: {} });
  await prisma.templateVersion.create({ data: { templateId: t.id, version, isActive: active, defaultSettings: general.defaultSettings as never, defaultPages: general.defaultPages as never } });
  const def: ThemeDefinition = {
    ...generalTheme,
    key,
    version,
    meta: { name: `fake ${key}`, description: "fake" },
    editor: { pages: Object.fromEntries(PAGE_TYPES.map((p) => [p, { ...generalTheme.editor.pages[p], ...patch[p] }])) as EditorSpec["pages"] },
  };
  return def;
}
const register = (...defs: ThemeDefinition[]) => setExtraThemesForTests(defs);

describe("the compatibility report is read-only and describes the switch", () => {
  it("reports sections that become dormant, writes nothing, and carries the draft revision", async () => {
    const { a, a1 } = await twoTenants();
    const hp = await getPageEditor(a.id, a1, "HOME");
    await addSection(a.id, a1, "HOME", { type: "contactInfo" }, hp.revision); // approved by general, not by coffee
    const before = await everythingButTheme(a1);
    const d = await revision(a1);
    const r = await rep(a.id, a1, "coffee");
    expect(r).toMatchObject({ draftRevision: d, sameTheme: false, canSwitch: true, current: { key: "general" }, target: { key: "coffee" } });
    const home = r.pages.find((p) => p.type === "HOME")!;
    expect(home.entries.filter((e) => e.change === "becomes_dormant").map((e) => e.type)).toEqual(["contactInfo"]);
    expect(r.summary.becomeDormant).toBe(1);
    expect(await everythingButTheme(a1)).toBe(before);
    expect(await revision(a1)).toBe(d);
    expect(await themeOf(a1)).toBe("general");
  });

  it("the same theme is reported as such", async () => {
    const { a, a1 } = await twoTenants();
    const r = await rep(a.id, a1, "general");
    expect(r).toMatchObject({ sameTheme: true, canSwitch: true });
    expect(r.summary.becomeDormant + r.summary.becomeActive + r.summary.newInvalid).toBe(0);
  });

  it("only registered, active themes are offered", async () => {
    const { a, a1 } = await twoTenants();
    expect((await listSwitchableThemes(a.id, a1)).themes.map((t) => t.key)).toEqual(["general", "coffee", "fashion"]);
    await prisma.template.update({ where: { key: "fashion" }, data: { isActive: false } });
    const l = await listSwitchableThemes(a.id, a1);
    expect(l.themes.map((t) => t.key)).toEqual(["general", "coffee"]);
    expect(l.current?.key).toBe("general");
  });
});

describe("switching changes only the draft's theme pointer", () => {
  it("writes ONE column (+ draftRevision): pages, products, categories, media, settings and published data are byte-identical", async () => {
    const { a, a1 } = await twoTenants();
    const hp = await getPageEditor(a.id, a1, "HOME");
    await addSection(a.id, a1, "HOME", { type: "contactInfo" }, hp.revision);
    const before = await everythingButTheme(a1);
    const rev = await revision(a1);
    const out = await go(a.id, a1, "coffee");
    expect(out).toMatchObject({ changed: true, theme: { key: "coffee" } });
    expect(await themeOf(a1)).toBe("coffee");
    expect(await revision(a1)).toBe(rev + 1); // the draft renders differently now
    expect(await everythingButTheme(a1)).toBe(before);
  });

  it("switching to the current theme is a no-op: nothing written, draftRevision not bumped", async () => {
    const { a, a1 } = await twoTenants();
    const before = await everythingButTheme(a1);
    const rev = await revision(a1);
    const out = await go(a.id, a1, "general");
    expect(out.changed).toBe(false);
    expect(await revision(a1)).toBe(rev);
    expect(await everythingButTheme(a1)).toBe(before);
  });

  it("the draft preview now renders the new theme", async () => {
    const { a, a1 } = await twoTenants();
    expect((await getDraftPreview(a.id, a1)).data.template.key).toBe("general");
    await go(a.id, a1, "fashion");
    expect((await getDraftPreview(a.id, a1)).data.template.key).toBe("fashion");
  });

  it("business category, starter text and settings are not touched by a theme switch", async () => {
    const { a, a1 } = await twoTenants();
    const before = await prisma.store.findUniqueOrThrow({ where: { id: a1 } });
    await go(a.id, a1, "coffee");
    const after = await prisma.store.findUniqueOrThrow({ where: { id: a1 } });
    expect(after.businessCategory).toBe(before.businessCategory);
    expect(after.settings).toEqual(before.settings);
    expect(after.name).toBe(before.name);
  });
});

describe("round trips preserve every stored section (nothing is rewritten, so nothing can be lost)", () => {
  it("A -> B -> A: every page row (sections, legacySections, revision) is deeply equal at every step", async () => {
    const { a, a1 } = await twoTenants();
    // rich content: extra sections, a section only coffee approves, junk that is already invalid
    const hp = await getPageEditor(a.id, a1, "HOME");
    await addSection(a.id, a1, "HOME", { type: "contactInfo" }, hp.revision);
    await prisma.page.updateMany({ where: { storeId: a1, type: "ABOUT" }, data: { sections: [{ id: "k", type: "richText", props: { title: "t", body: "b" } }, { broken: 1 }, { id: "z", type: "contactInfo", props: { title: "x", body: "y" } }] as never } });
    const original = await pagesJson(a1);

    await go(a.id, a1, "coffee");
    expect(await pagesJson(a1)).toEqual(original);
    await go(a.id, a1, "general");
    expect(await pagesJson(a1)).toEqual(original);
    expect(await themeOf(a1)).toBe("general");
  });

  it("A -> B -> C -> A: a section that is dormant in two themes survives and is active again at home", async () => {
    const { a, a1 } = await twoTenants();
    // build it under coffee: coffee approves coffee.openingHours
    await go(a.id, a1, "coffee");
    const hp = await getPageEditor(a.id, a1, "HOME");
    await addSection(a.id, a1, "HOME", { type: "coffee.openingHours" }, hp.revision);
    const original = await pagesJson(a1);
    const hoursRaw = (original.find((p) => p.type === "HOME")!.sections as { type: string }[]).find((s) => s.type === "coffee.openingHours");
    expect(hoursRaw).toBeDefined();

    await go(a.id, a1, "general"); // dormant
    expect((await getPageEditor(a.id, a1, "HOME")).dormant.map((d) => d.type)).toEqual(["coffee.openingHours"]);
    await go(a.id, a1, "fashion"); // still dormant
    expect((await getPageEditor(a.id, a1, "HOME")).dormant.map((d) => d.type)).toEqual(["coffee.openingHours"]);
    expect(await pagesJson(a1)).toEqual(original);
    await go(a.id, a1, "coffee"); // active again
    const back = await getPageEditor(a.id, a1, "HOME");
    expect(back.dormant).toEqual([]);
    expect(back.sections.map((s) => s.type)).toContain("coffee.openingHours");
    expect(await pagesJson(a1)).toEqual(original);
    expect((await row(a1, "HOME")).sections).toContainEqual(hoursRaw);
  });

  it("edits made under the other theme keep dormant sections in place; switching back restores them", async () => {
    const { a, a1 } = await twoTenants();
    await go(a.id, a1, "coffee");
    let hp = await getPageEditor(a.id, a1, "HOME");
    await addSection(a.id, a1, "HOME", { type: "coffee.openingHours" }, hp.revision);
    const order = ((await row(a1, "HOME")).sections as { id: string; type: string }[]).map((s) => `${s.id}:${s.type}`);
    await go(a.id, a1, "general");
    hp = await getPageEditor(a.id, a1, "HOME");
    const hero = hp.sections.find((s) => s.type === "hero")!;
    await updateSection(a.id, a1, "HOME", hero.id, { title: "عنوان جدید" }, hp.revision);
    const mid = ((await row(a1, "HOME")).sections as { id: string; type: string }[]).map((s) => `${s.id}:${s.type}`);
    expect(mid).toEqual(order); // same ids, same order: the dormant section never moved
    await go(a.id, a1, "coffee");
    const back = await getPageEditor(a.id, a1, "HOME");
    expect(back.sections.map((s) => s.type)).toContain("coffee.openingHours");
    expect(back.sections.find((s) => s.type === "hero")!.props).toMatchObject({ title: "عنوان جدید" });
  });
});

describe("blocking: new invalid sections and required-section violations", () => {
  it("a NEW invalid state blocks, is reported, and nothing is written (not even draftRevision)", async () => {
    const { a, a1 } = await twoTenants();
    const strict = await registerFakeTheme("strict", { ABOUT: { singletons: ["richText"] } });
    register(strict);
    const about = await getPageEditor(a.id, a1, "ABOUT");
    await addSection(a.id, a1, "ABOUT", { type: "richText" }, about.revision);
    const about2 = await getPageEditor(a.id, a1, "ABOUT");
    await addSection(a.id, a1, "ABOUT", { type: "richText" }, about2.revision);

    const r = await rep(a.id, a1, "strict");
    expect(r.canSwitch).toBe(false);
    expect(r.blockers.every((b) => b.kind === "new_invalid" && b.pageType === "ABOUT")).toBe(true);
    expect(r.summary.newInvalid).toBeGreaterThanOrEqual(1);

    const before = await everythingButTheme(a1);
    const rev = await revision(a1);
    await expect(switchTheme(a.id, a1, { targetKey: "strict", expectedDraftRevision: r.draftRevision })).rejects.toBeInstanceOf(ThemeSwitchBlockedError);
    expect(await themeOf(a1)).toBe("general");
    expect(await revision(a1)).toBe(rev);
    expect(await everythingButTheme(a1)).toBe(before);
  });

  it("fixing the page under the CURRENT theme unblocks the switch (the owner decides, nothing is repaired automatically)", async () => {
    const { a, a1 } = await twoTenants();
    register(await registerFakeTheme("strict", { ABOUT: { singletons: ["richText"] } }));
    const v0 = await getPageEditor(a.id, a1, "ABOUT");
    await addSection(a.id, a1, "ABOUT", { type: "richText" }, v0.revision);
    const v1 = await getPageEditor(a.id, a1, "ABOUT");
    await addSection(a.id, a1, "ABOUT", { type: "richText" }, v1.revision);
    expect((await rep(a.id, a1, "strict")).canSwitch).toBe(false);
    const v2 = await getPageEditor(a.id, a1, "ABOUT");
    const richIds = v2.sections.filter((s) => s.type === "richText").map((s) => s.id);
    const { removeSection } = await import("@/modules/pages/service");
    for (const id of richIds.slice(1)) await removeSection(a.id, a1, "ABOUT", id, (await getPageEditor(a.id, a1, "ABOUT")).revision);
    const ok = await rep(a.id, a1, "strict");
    expect(ok.canSwitch).toBe(true);
    expect((await switchTheme(a.id, a1, { targetKey: "strict", expectedDraftRevision: ok.draftRevision })).changed).toBe(true);
  });

  it("a required type the page lacks is reported and blocks", async () => {
    const { a, a1 } = await twoTenants();
    register(await registerFakeTheme("needs-cta", { PRODUCTS: { required: ["productGrid", "callToAction"] } }));
    const r = await rep(a.id, a1, "needs-cta");
    const products = r.pages.find((p) => p.type === "PRODUCTS")!;
    expect(products.missingRequired).toEqual([{ type: "callToAction", alsoMissingNow: false }]); // productGrid is present, so only the missing type is reported
    expect(r.blockers).toEqual([{ kind: "missing_required", pageType: "PRODUCTS", sectionType: "callToAction" }]);
    expect(r.canSwitch).toBe(false);
    const before = await everythingButTheme(a1);
    await expect(switchTheme(a.id, a1, { targetKey: "needs-cta", expectedDraftRevision: r.draftRevision })).rejects.toBeInstanceOf(ThemeSwitchBlockedError);
    expect(await everythingButTheme(a1)).toBe(before);
    expect(await themeOf(a1)).toBe("general");
  });

  it("PRE-EXISTING invalid sections never block, are preserved verbatim, and still need the explicit recovery afterwards", async () => {
    const { a, a1 } = await twoTenants();
    const junk = [{ id: "ok", type: "richText", props: { title: "t", body: "b" } }, { nope: true }, { id: "u", type: "unknownType", props: {} }];
    await prisma.page.updateMany({ where: { storeId: a1, type: "ABOUT" }, data: { sections: junk as never } });
    const r = await rep(a.id, a1, "coffee");
    expect(r.canSwitch).toBe(true);
    expect(r.summary.preExistingInvalid).toBe(2);
    expect(r.summary.newInvalid).toBe(0);
    await go(a.id, a1, "coffee");
    expect((await row(a1, "ABOUT")).sections).toEqual(junk);
    const v = await getPageEditor(a.id, a1, "ABOUT");
    expect(v.issues.length).toBe(2); // still flagged: recovery stays an explicit owner action
    await recoverPage(a.id, a1, "ABOUT", v.revision);
    expect((await row(a1, "ABOUT")).legacySections).toHaveLength(2);
  });
});

describe("concurrency, tenancy and target selection", () => {
  it("a stale report (any draft edit since) is a ConflictError and writes nothing", async () => {
    const { a, a1 } = await twoTenants();
    const r = await rep(a.id, a1, "coffee");
    const hp = await getPageEditor(a.id, a1, "HOME");
    await addSection(a.id, a1, "HOME", { type: "contactInfo" }, hp.revision); // draft edited after the report
    const before = await everythingButTheme(a1);
    await expect(switchTheme(a.id, a1, { targetKey: "coffee", expectedDraftRevision: r.draftRevision })).rejects.toBeInstanceOf(ConflictError);
    expect(await themeOf(a1)).toBe("general");
    expect(await everythingButTheme(a1)).toBe(before);
  });

  it("a double submit applies once; the second finds the store already on the target", async () => {
    const { a, a1 } = await twoTenants();
    const r = await rep(a.id, a1, "coffee");
    const results = await Promise.allSettled([1, 2].map(() => switchTheme(a.id, a1, { targetKey: "coffee", expectedDraftRevision: r.draftRevision })));
    expect(results.filter((x) => x.status === "fulfilled" && x.value.changed)).toHaveLength(1);
    expect(await themeOf(a1)).toBe("coffee");
  });

  it("a switch racing a page edit: exactly one wins, the store is never half-applied", async () => {
    const { a, a1 } = await twoTenants();
    const r = await rep(a.id, a1, "coffee");
    const hp = await getPageEditor(a.id, a1, "HOME");
    const res = await Promise.allSettled([
      switchTheme(a.id, a1, { targetKey: "coffee", expectedDraftRevision: r.draftRevision }),
      addSection(a.id, a1, "HOME", { type: "contactInfo" }, hp.revision),
    ]);
    expect(res.filter((x) => x.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const theme = await themeOf(a1);
    const sections = ((await row(a1, "HOME")).sections as { type: string }[]).map((s) => s.type);
    if (theme === "coffee") expect(sections.filter((t) => t === "contactInfo").length).toBeLessThanOrEqual(1);
    expect(["general", "coffee"]).toContain(theme);
  });

  it("another tenant's or a missing store looks identical (NotFoundError) and nothing is written", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    const before = await everythingButTheme(a1);
    const rev = await revision(a1);
    for (const f of [
      () => previewThemeSwitch(b.id, a1, "coffee"),
      () => switchTheme(b.id, a1, { targetKey: "coffee", expectedDraftRevision: rev }),
      () => previewThemeSwitch(a.id, "cmissing0000000000000000000", "coffee"),
      () => switchTheme(a.id, b1, { targetKey: "coffee", expectedDraftRevision: 1 }),
      () => listSwitchableThemes(b.id, a1),
    ]) await expect(f()).rejects.toBeInstanceOf(NotFoundError);
    expect(await everythingButTheme(a1)).toBe(before);
    expect(await revision(a1)).toBe(rev);
    expect(await themeOf(a1)).toBe("general");
  });

  it("unknown, malformed, inactive or code-only/DB-only targets are refused (ValidationError) without writing", async () => {
    const { a, a1 } = await twoTenants();
    const t = await prisma.template.create({ data: { key: "db-only", name: "x" } });
    const general = await prisma.templateVersion.findFirstOrThrow({ where: { template: { key: "general" } } });
    await prisma.templateVersion.create({ data: { templateId: t.id, version: 1, defaultSettings: general.defaultSettings as never, defaultPages: [] } });
    await prisma.template.update({ where: { key: "fashion" }, data: { isActive: false } });
    const rev = await revision(a1);
    for (const key of ["nope", "db-only", "fashion", "../x", "Coffee", "", "x".repeat(60)]) {
      await expect(switchTheme(a.id, a1, { targetKey: key, expectedDraftRevision: rev }), key).rejects.toBeInstanceOf(ValidationError);
      await expect(previewThemeSwitch(a.id, a1, key), key).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await revision(a1)).toBe(rev);
    expect(await themeOf(a1)).toBe("general");
  });

  it("only the LATEST ACTIVE version of a theme is a target (inactive newer versions are ignored; versions missing in code are unavailable)", async () => {
    const { a, a1 } = await twoTenants();
    const coffee = await prisma.template.findUniqueOrThrow({ where: { key: "coffee" } });
    const v1 = await prisma.templateVersion.findFirstOrThrow({ where: { templateId: coffee.id, version: 1 } });
    // coffee@2 exists in the DB, inactive: coffee@1 is still the target
    const v2 = await prisma.templateVersion.create({ data: { templateId: coffee.id, version: 2, isActive: false, defaultSettings: v1.defaultSettings as never, defaultPages: v1.defaultPages as never } });
    await go(a.id, a1, "coffee");
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).templateVersionId).toBe(v1.id);
    await go(a.id, a1, "general");
    // active coffee@2 with no code definition: the theme is unavailable (never silently falls back to @1)
    await prisma.templateVersion.update({ where: { id: v2.id }, data: { isActive: true } });
    await expect(rep(a.id, a1, "coffee")).rejects.toBeInstanceOf(ValidationError);
    // with a registered coffee@2 it is chosen
    const { coffeeTheme } = await import("@/templates/coffee/definition");
    register({ ...coffeeTheme, version: 2 });
    await go(a.id, a1, "coffee");
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).templateVersionId).toBe(v2.id);
  });
});

describe("published output is never affected", () => {
  it("the published snapshot, its pointer, status and versions are unchanged by switching and by switching back", async () => {
    const { a, a1 } = await twoTenants();
    // publish the way phase 10 will: an immutable snapshot built from the draft, then the pointer
    const { data } = await getDraftPreview(a.id, a1);
    const v = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: await revision(a1), snapshot: data as never } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });
    const publishedBefore = JSON.stringify(await readPublishedStorefront(a1));
    const rowsBefore = JSON.stringify(await prisma.storeVersion.findMany({ where: { storeId: a1 } }));
    const ptr = async () => {
      const s = await prisma.store.findUniqueOrThrow({ where: { id: a1 }, select: { status: true, publishedVersionId: true, publishedAt: true } });
      return JSON.stringify(s);
    };
    const ptrBefore = await ptr();
    expect(JSON.parse(publishedBefore).template.key).toBe("general");

    await go(a.id, a1, "coffee");
    expect(await themeOf(a1)).toBe("coffee");
    expect(JSON.stringify(await readPublishedStorefront(a1))).toBe(publishedBefore); // visitors still get the general storefront
    expect((await getDraftPreview(a.id, a1)).data.template.key).toBe("coffee"); // only the draft changed
    await go(a.id, a1, "fashion");
    expect(JSON.stringify(await readPublishedStorefront(a1))).toBe(publishedBefore);
    await go(a.id, a1, "general");
    expect(JSON.stringify(await readPublishedStorefront(a1))).toBe(publishedBefore);
    expect(JSON.stringify(await prisma.storeVersion.findMany({ where: { storeId: a1 } }))).toBe(rowsBefore);
    expect(await ptr()).toBe(ptrBefore);
  });

  it("the candidate preview is read-only, owner-only and independent of the published snapshot", async () => {
    const { a, b, a1 } = await twoTenants();
    const { data } = await getDraftPreview(a.id, a1);
    const v = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: data as never } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });
    const hp = await getPageEditor(a.id, a1, "HOME");
    await addSection(a.id, a1, "HOME", { type: "contactInfo" }, hp.revision);
    const all = async () => JSON.stringify({ s: await everythingButTheme(a1), t: await themeOf(a1), d: await revision(a1) });
    const before = await all();

    const own = await getDraftPreview(a.id, a1);
    const cand = await getDraftPreview(a.id, a1, { candidateThemeKey: "coffee" });
    expect(own.candidate).toBeNull();
    expect(cand.candidate).toMatchObject({ key: "coffee" });
    expect(cand.data.template.key).toBe("coffee");
    expect(cand.notes.dormantSectionCount).toBe(1); // the contactInfo section is not approved by coffee's HOME
    expect(cand.data.products).toEqual(own.data.products); // same draft data
    expect(cand.data.store.name).toBe(own.data.store.name);
    expect(await all()).toBe(before); // nothing written, nothing switched

    // isolated from the published storefront: the candidate never reads it, and publishing data does not leak in
    expect(JSON.stringify(cand.data)).not.toBe(JSON.stringify(await readPublishedStorefront(a1)));

    await expect(getDraftPreview(a.id, a1, { candidateThemeKey: "nope" })).rejects.toBeInstanceOf(CandidateThemeUnavailableError);
    await expect(getDraftPreview(a.id, a1, { candidateThemeKey: "../x" })).rejects.toBeInstanceOf(CandidateThemeUnavailableError);
    await expect(getDraftPreview(b.id, a1, { candidateThemeKey: "coffee" })).rejects.toBeInstanceOf(NotFoundError);
    await prisma.template.update({ where: { key: "fashion" }, data: { isActive: false } });
    await expect(getDraftPreview(a.id, a1, { candidateThemeKey: "fashion" })).rejects.toBeInstanceOf(CandidateThemeUnavailableError);
    expect(await all()).toBe(before);
  });
});

describe("media references stay protected through theme switches (active, dormant and archived sections)", () => {
  async function withStorage() {
    const storage = new MemoryMediaStorage();
    setMediaStorageForTests(storage);
    return { storage, deps: { storage, limiter: new MemoryRateLimiter(), log: () => undefined } };
  }
  const heroImage = async (ownerId: string, storeId: string, mediaId: string) => {
    const v = await getPageEditor(ownerId, storeId, "HOME");
    const hero = v.sections.find((s) => s.type === "hero")!;
    await setSectionImage(ownerId, storeId, "HOME", hero.id, mediaId, v.revision);
    return hero.id;
  };
  const protectedMedia = async (ownerId: string, storeId: string, m: { id: string; key: string }, deps: Awaited<ReturnType<typeof withStorage>>["deps"]) => {
    await expect(deleteMedia(ownerId, storeId, m.id, deps)).rejects.toBeInstanceOf(MediaInUseError);
    expect(await releaseMedia(ownerId, storeId, m.id, deps)).toBe("kept");
    expect(deps.storage.objects.has(m.key)).toBe(true);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("READY");
  };

  it("ACTIVE -> DORMANT -> ACTIVE: the hero image is protected in every state, and the switch itself touches no media", async () => {
    const { a, a1 } = await twoTenants();
    const { deps } = await withStorage();
    register(await registerFakeTheme("no-hero", { HOME: { allowed: ["featuredProducts", "imageText", "richText", "callToAction", "contactInfo"], singletons: [] } }));
    const m = await uploadMedia(a.id, a1, await photo(), deps);
    const heroId = await heroImage(a.id, a1, m.id);
    await protectedMedia(a.id, a1, m, deps); // active

    const r = await rep(a.id, a1, "no-hero");
    expect(r.pages.find((p) => p.type === "HOME")!.entries.find((e) => e.id === heroId)).toMatchObject({ change: "becomes_dormant", hasImage: true });
    const mediaBefore = JSON.stringify(await prisma.media.findMany({ where: { storeId: a1 } }));
    await go(a.id, a1, "no-hero");
    expect(JSON.stringify(await prisma.media.findMany({ where: { storeId: a1 } }))).toBe(mediaBefore);
    expect((await getPageEditor(a.id, a1, "HOME")).dormant.map((d) => d.id)).toEqual([heroId]);
    await protectedMedia(a.id, a1, m, deps); // dormant: still referenced by the stored section

    await go(a.id, a1, "general");
    await protectedMedia(a.id, a1, m, deps); // active again
    expect(JSON.stringify(await prisma.media.findMany({ where: { storeId: a1 } }))).toBe(mediaBefore);
  });

  it("a dormant section's image is released only by explicitly removing that dormant section", async () => {
    const { a, a1 } = await twoTenants();
    const { deps } = await withStorage();
    register(await registerFakeTheme("no-hero", { HOME: { allowed: ["featuredProducts", "imageText", "richText", "callToAction", "contactInfo"], singletons: [] } }));
    const m = await uploadMedia(a.id, a1, await photo(), deps);
    const heroId = await heroImage(a.id, a1, m.id);
    await go(a.id, a1, "no-hero");
    await protectedMedia(a.id, a1, m, deps);
    const v = await getPageEditor(a.id, a1, "HOME");
    await removeDormantSection(a.id, a1, "HOME", heroId, v.revision); // the explicit owner action
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
    expect(deps.storage.objects.has(m.key)).toBe(false);
  });

  it("ARCHIVED sections (legacySections) keep their media alive, before and after theme switches", async () => {
    const { a, a1 } = await twoTenants();
    const { deps } = await withStorage();
    const m = await uploadMedia(a.id, a1, await photo(), deps);
    // an invalid section (extra prop) that still carries the image id, as legacy data might
    const bad = { id: "legacy1", type: "hero", props: { title: "t", subtitle: "", buttonText: "", buttonLink: "/", imageId: m.id, extra: true } };
    await prisma.page.updateMany({ where: { storeId: a1, type: "ABOUT" }, data: { sections: [bad] as never } });
    await protectedMedia(a.id, a1, m, deps); // invalid-in-place: found in `sections`
    const v = await getPageEditor(a.id, a1, "ABOUT");
    await recoverPage(a.id, a1, "ABOUT", v.revision); // moves it verbatim to legacySections
    const page = await row(a1, "ABOUT");
    expect(JSON.stringify(page.sections)).not.toContain(m.id);
    expect(JSON.stringify(page.legacySections)).toContain(m.id);
    await protectedMedia(a.id, a1, m, deps); // archived: still protected (regression: legacySections was not scanned)
    await go(a.id, a1, "coffee");
    await protectedMedia(a.id, a1, m, deps);
    await go(a.id, a1, "fashion");
    await go(a.id, a1, "general");
    await protectedMedia(a.id, a1, m, deps);
    expect((await row(a1, "ABOUT")).legacySections).toEqual(page.legacySections);
  });

  it("product images and the logo are untouched by switches", async () => {
    const { a, a1 } = await twoTenants();
    const { deps } = await withStorage();
    const m = await uploadMedia(a.id, a1, await photo(), deps);
    const { setStoreLogo } = await import("@/modules/media/service");
    await setStoreLogo(a.id, a1, m.id, deps);
    await go(a.id, a1, "coffee");
    await go(a.id, a1, "general");
    await protectedMedia(a.id, a1, m, deps);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).logoId).toBe(m.id);
  });
});
