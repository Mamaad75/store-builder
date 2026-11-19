import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS } from "@/templates/definitions";
import { StorefrontBuildError, buildStorefrontData, type StorefrontSource } from "./build";

const general = TEMPLATE_DEFINITIONS.find((t) => t.key === "general")!;

const source = (over: Partial<StorefrontSource> = {}): StorefrontSource => ({
  store: { name: "فروشگاه", settings: general.settings },
  template: { key: "general", version: 1, defaultSettings: general.settings },
  pages: general.pages.map((p, i) => ({ ...p, position: i })),
  categories: [{ id: "c1", name: "چای", slug: "چای" }],
  products: [{ id: "p1", name: "چای", slug: "چای", description: "", price: 1000, stockQuantity: 1, categoryId: "c1" }],
  excludedProductCount: 2,
  ...over,
});

describe("buildStorefrontData: media", () => {
  const key = (c: string) => `stores/s1/${c.repeat(32)}.webp`;
  it("exposes only READY images with known dimensions (PENDING/DELETING/unsized never reach templates)", () => {
    const mk = (id: string, status: string, w: number | null = 10, h: number | null = 10) => ({ id, name: id, slug: id, description: "", price: 1, stockQuantity: 1, categoryId: null, image: { key: key(id[0]!), width: w, height: h, status } });
    const { data } = buildStorefrontData(source({ categories: [], products: [mk("a", "READY"), mk("b", "PENDING"), mk("c", "DELETING"), mk("d", "READY", null, null)], store: { name: "x", settings: general.settings, logo: { key: key("e"), width: 5, height: 5, status: "DELETING" } } }));
    expect(data.products.map((p) => p.image?.key ?? null)).toEqual([key("a"), null, null, null]);
    expect(data.store.logo).toBeNull();
  });
});

describe("buildStorefrontData (pure)", () => {
  it("builds valid data and reports only a count for excluded products", () => {
    const { data, notes } = buildStorefrontData(source());
    expect(data.products).toHaveLength(1);
    expect(notes.excludedProductCount).toBe(2);
    expect(JSON.stringify(data)).not.toMatch(/status|ownerId|storeId/);
  });
  it("invalid persisted sections are skipped and reported, valid ones kept", () => {
    const pages = source().pages.map((p) => (p.type === "HOME" ? { ...p, sections: [...(p.sections as unknown[]), { id: "bad", type: "hero", props: {} }, { id: "old", type: "carousel", props: {} }] } : p));
    const { data, notes } = buildStorefrontData(source({ pages }));
    const home = data.pages.find((p) => p.type === "HOME")!;
    expect(home.sections.map((s) => s.id)).not.toContain("bad");
    expect(home.sections.length).toBe(4);
    expect(notes.skippedSections[0]).toMatchObject({ pageType: "HOME" });
    expect(notes.skippedSections[0]!.issues.map((i) => i.reason)).toEqual(["invalid_props", "unsupported_type"]);
  });
  it("sections that are not an array become an empty page, not a crash", () => {
    const pages = source().pages.map((p) => (p.type === "ABOUT" ? { ...p, sections: { oops: true } } : p));
    const { data, notes } = buildStorefrontData(source({ pages }));
    expect(data.pages.find((p) => p.type === "ABOUT")!.sections).toEqual([]);
    expect(notes.skippedSections.some((s) => s.pageType === "ABOUT")).toBe(true);
  });
  it("invalid store settings fall back to the template defaults and are reported", () => {
    for (const settings of [{}, null, "x", { primaryColor: "red" }]) {
      const { data, notes } = buildStorefrontData(source({ store: { name: "x", settings } }));
      expect(data.store.primaryColor).toBe(general.settings.primaryColor);
      expect(notes.settingsFallback).toBe(true);
    }
  });
  it("valid settings are used as-is", () => {
    const { data, notes } = buildStorefrontData(source({ store: { name: "x", settings: { ...general.settings, primaryColor: "#112233" } } }));
    expect(data.store.primaryColor).toBe("#112233");
    expect(notes.settingsFallback).toBe(false);
  });
  it("orders pages by position", () => {
    const pages = source().pages.map((p, i) => ({ ...p, position: 10 - i }));
    const { data } = buildStorefrontData(source({ pages }));
    expect(data.pages.map((p) => p.position)).toEqual([6, 7, 8, 9, 10]);
  });
  it("throws when the result still violates the contract (e.g. product in an unknown category)", () => {
    const products = [{ id: "p1", name: "x", slug: "x", description: "", price: 1, stockQuantity: 1, categoryId: "ghost" }];
    expect(() => buildStorefrontData(source({ products }))).toThrow(StorefrontBuildError);
  });
});

describe("buildStorefrontData: the optional store description (phase 11)", () => {
  it("is ABSENT from the data when the owner set none, so existing stores keep byte-identical snapshots", () => {
    const { data } = buildStorefrontData(source());
    expect("description" in data.store).toBe(false);
    const blank = buildStorefrontData(source({ store: { name: "x", settings: { ...general.settings, description: "" } } }));
    expect("description" in blank.data.store).toBe(false);
    expect(JSON.stringify(blank.data)).toBe(JSON.stringify(buildStorefrontData(source({ store: { name: "x", settings: general.settings } })).data));
  });
  it("is carried into the data when set", () => {
    const { data } = buildStorefrontData(source({ store: { name: "x", settings: { ...general.settings, description: "فروشگاه چای" } } }));
    expect(data.store.description).toBe("فروشگاه چای");
  });
});
