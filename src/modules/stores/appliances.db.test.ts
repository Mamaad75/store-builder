import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBusinessCategory } from "@/lib/business-categories";
import { addSection, getPageEditor } from "@/modules/pages/service";
import { getDraftPreview } from "@/modules/storefront/service";
import { setExtraThemesForTests } from "@/templates/theme-catalog";
import { makeUser, prisma, resetDb } from "@/test/db-helpers";
import { ValidationError } from "./errors";
import { createStore } from "./service";
import { previewThemeSwitch, switchTheme } from "./theme-switch";

beforeEach(resetDb);
afterEach(() => setExtraThemesForTests([]));
afterAll(() => prisma.$disconnect());

const go = async (ownerId: string, storeId: string, key: string) => switchTheme(ownerId, storeId, { targetKey: key, expectedDraftRevision: (await previewThemeSwitch(ownerId, storeId, key)).draftRevision });
const pagesJson = async (storeId: string) => JSON.stringify((await prisma.page.findMany({ where: { storeId }, orderBy: { type: "asc" } })).map((p) => [p.type, p.sections, p.legacySections, p.revision]));

describe("the appliances theme and the home-appliances category", () => {
  it("the category suggests the appliances theme first (and still allows any other theme)", () => {
    expect(getBusinessCategory("home-appliances")!.suggestedThemes[0]).toBe("appliances");
    expect(getBusinessCategory("home-appliances")!.suggestedThemes).toContain("general");
  });

  it("a home-appliances store on the appliances theme gets the five standard pages with the category's starter text, and previews with that theme", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "لوازم خانگی من", templateKey: "appliances", businessCategory: "home-appliances" });
    const s = await prisma.store.findUniqueOrThrow({ where: { id }, include: { templateVersion: { include: { template: true } }, pages: true } });
    expect(s.templateVersion.template.key).toBe("appliances");
    expect(s.businessCategory).toBe("home-appliances");
    expect(s.pages.map((p) => p.type).sort()).toEqual(["ABOUT", "CONTACT", "HOME", "PRODUCTS", "PRODUCT_DETAIL"]);
    expect(JSON.stringify((s.pages.find((p) => p.type === "HOME")!.sections))).toContain("لوازم خانگی مطمئن برای خانهٔ شما");
    expect((await getDraftPreview(u.id, id)).data.template.key).toBe("appliances");
  });

  it("any other category can use the appliances theme, and a home-appliances store can use any other theme", async () => {
    const u = await makeUser();
    const a = await createStore(u.id, { name: "کافه", templateKey: "appliances", businessCategory: "coffee-food" });
    const b = await createStore(u.id, { name: "لوازم", templateKey: "fashion", businessCategory: "home-appliances" });
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a.id } })).businessCategory).toBe("coffee-food");
    expect((await getDraftPreview(u.id, b.id)).data.template.key).toBe("fashion");
  });

  it("without a category the best-effort inference picks home-appliances for the appliances theme", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "x", templateKey: "appliances" });
    expect((await prisma.store.findUniqueOrThrow({ where: { id } })).businessCategory).toBe("home-appliances");
  });

  it("appliances.serviceInfo is approved on home, about and contact (singleton) and not on products", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "x", templateKey: "appliances" });
    for (const page of ["HOME", "ABOUT", "CONTACT"] as const) {
      await addSection(u.id, id, page, { type: "appliances.serviceInfo" }, (await getPageEditor(u.id, id, page)).revision);
      const v = await getPageEditor(u.id, id, page);
      expect(v.sections.filter((s) => s.type === "appliances.serviceInfo")).toHaveLength(1);
      await expect(addSection(u.id, id, page, { type: "appliances.serviceInfo" }, v.revision), `${page} singleton`).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(addSection(u.id, id, "PRODUCTS", { type: "appliances.serviceInfo" }, (await getPageEditor(u.id, id, "PRODUCTS")).revision)).rejects.toBeInstanceOf(ValidationError);
  });

  it("the section is dormant under the other themes and active again under appliances, with every page row unchanged (A -> B -> C -> A)", async () => {
    const u = await makeUser();
    const { id } = await createStore(u.id, { name: "x", templateKey: "appliances" });
    await addSection(u.id, id, "HOME", { type: "appliances.serviceInfo" }, (await getPageEditor(u.id, id, "HOME")).revision);
    const original = await pagesJson(id);

    const toGeneral = await previewThemeSwitch(u.id, id, "general");
    expect(toGeneral.pages.find((p) => p.type === "HOME")!.entries.filter((e) => e.change === "becomes_dormant").map((e) => e.type)).toEqual(["appliances.serviceInfo"]);
    expect(toGeneral.canSwitch).toBe(true);

    for (const key of ["general", "coffee", "fashion"]) {
      await go(u.id, id, key);
      expect((await getPageEditor(u.id, id, "HOME")).dormant.map((d) => d.type), key).toEqual(["appliances.serviceInfo"]);
      expect(await pagesJson(id), key).toBe(original);
    }
    const back = await previewThemeSwitch(u.id, id, "appliances");
    expect(back.pages.find((p) => p.type === "HOME")!.entries.filter((e) => e.change === "becomes_active").map((e) => e.type)).toEqual(["appliances.serviceInfo"]);
    await go(u.id, id, "appliances");
    const v = await getPageEditor(u.id, id, "HOME");
    expect(v.dormant).toEqual([]);
    expect(v.sections.map((s) => s.type)).toContain("appliances.serviceInfo");
    expect(await pagesJson(id)).toBe(original);
  });

  it("every existing store of the other three themes is unaffected by the new theme (their theme pointers and pages are unchanged)", async () => {
    const u = await makeUser();
    const ids = await Promise.all(["general", "coffee", "fashion"].map(async (k) => (await createStore(u.id, { name: k, templateKey: k })).id));
    const before = await Promise.all(ids.map(pagesJson));
    const preview = await previewThemeSwitch(u.id, ids[0]!, "appliances");
    expect(preview.canSwitch).toBe(true); // switching INTO the new theme is possible from any existing theme
    expect(await Promise.all(ids.map(pagesJson))).toEqual(before);
  });
});
