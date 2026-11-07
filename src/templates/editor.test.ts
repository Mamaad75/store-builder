import { describe, expect, it } from "vitest";
import { analyzePage } from "@/modules/pages/analyze";
import { TEMPLATE_DEFINITIONS } from "./definitions";
import { MAX_SECTIONS_PER_PAGE, NON_HIDEABLE_PAGES } from "./editor";
import { generalTemplate } from "./general";
import { SECTION_DEFAULTS, SECTION_LABELS, defaultSectionProps } from "./section-defaults";
import { IMAGE_SECTION_TYPES, LINK_TARGETS, SECTION_FIELDS, propsFromForm } from "./section-fields";
import {
  DEFAULT_TYPOGRAPHY,
  PAGE_TYPES,
  SECTION_TYPES,
  hexColorSchema,
  sectionPropsSchemas,
  templateSettingsSchema,
  typographySchema,
} from "./sections";

describe("limits and rules", () => {
  it("max 20 sections per page; HOME and PRODUCTS can never be hidden", () => {
    expect(MAX_SECTIONS_PER_PAGE).toBe(20);
    expect([...NON_HIDEABLE_PAGES].sort()).toEqual(["HOME", "PRODUCTS"]);
  });
});

describe("section defaults", () => {
  it.each(SECTION_TYPES)("%s: the default props satisfy the strict schema and have a label", (t) => {
    expect(sectionPropsSchemas[t].safeParse(SECTION_DEFAULTS[t]).success).toBe(true);
    expect(SECTION_LABELS[t].length).toBeGreaterThan(0);
  });
  it("defaultSectionProps returns an independent copy", () => {
    const a = defaultSectionProps("hero");
    a.title = "changed";
    expect(defaultSectionProps("hero").title).not.toBe("changed");
  });
});

describe("section form fields", () => {
  it.each(SECTION_TYPES)("%s: every field maps to a real prop; image ids are never form fields", (t) => {
    const shape = Object.keys((sectionPropsSchemas[t] as unknown as { shape: Record<string, unknown> }).shape);
    for (const f of SECTION_FIELDS[t]) {
      expect(shape, `${t}.${f.name}`).toContain(f.name);
      expect(f.name).not.toBe("imageId");
    }
    // every prop is either an editable field or the image reference
    const covered = new Set([...SECTION_FIELDS[t].map((f) => f.name), "imageId"]);
    for (const k of shape) expect(covered.has(k), `${t}.${k} is not editable`).toBe(true);
  });
  it("image-capable sections are exactly those that carry imageId", () => {
    const carrying = SECTION_TYPES.filter((t) => "imageId" in (sectionPropsSchemas[t] as unknown as { shape: object }).shape);
    expect([...IMAGE_SECTION_TYPES].sort()).toEqual([...carrying].sort());
  });
  it("propsFromForm reads only whitelisted fields, normalises text and parses numbers (Persian digits)", () => {
    const form: Record<string, string> = { title: "  كتاب  ", limit: "۸", buttonLink: " /products ", evil: "x", imageId: "ckforged", type: "hero" };
    const get = (n: string) => form[n] ?? null;
    expect(propsFromForm("featuredProducts", get)).toEqual({ title: "کتاب", limit: 8 });
    expect(propsFromForm("callToAction", get)).toEqual({ title: "کتاب", buttonLink: "/products" });
    expect(propsFromForm("hero", get)).not.toHaveProperty("imageId");
    expect(propsFromForm("categoryFilter", get)).toEqual({});
    expect(Number.isNaN(propsFromForm("featuredProducts", (n) => (n === "limit" ? "abc" : null)).limit)).toBe(true);
  });
  it("offers only internal link targets", () => {
    for (const t of LINK_TARGETS) expect(t.path).toMatch(/^\/[a-z]*$/);
  });
});

describe("general template editor spec", () => {
  const spec = generalTemplate.editor;
  it("covers every page type", () => {
    expect(Object.keys(spec.pages).sort()).toEqual([...PAGE_TYPES].sort());
  });
  it.each(PAGE_TYPES)("%s: allowed sections are renderable, singletons/required are allowed", (page) => {
    const r = spec.pages[page];
    for (const t of r.allowed) expect((generalTemplate.sections as Record<string, unknown>)[t] ?? generalTemplate.extraSections[t], `${page}: ${t} has no component`).toBeTypeOf("function");
    for (const t of [...r.singletons, ...r.required]) expect(r.allowed).toContain(t);
  });
  it("every seeded general page is fully editable out of the box", () => {
    const general = TEMPLATE_DEFINITIONS.find((d) => d.key === "general")!;
    for (const p of general.pages) {
      const a = analyzePage(p.sections, spec.pages[p.type]);
      expect(a.invalid, p.type).toEqual([]);
      for (const t of spec.pages[p.type].required) expect(a.sections.some((s) => s.type === t), `${p.type} needs ${t}`).toBe(true);
    }
  });
});

describe("analyzePage", () => {
  const rules = generalTemplate.editor.pages.ABOUT;
  const ok = { id: "a", type: "richText", props: { title: "t", body: "b" } };
  it("accepts valid approved sections as ACTIVE", () => {
    const a = analyzePage([ok], rules);
    expect(a.sections).toEqual([ok]);
    expect(a.entries).toEqual([{ kind: "active", section: ok, raw: ok, index: 0 }]); // `index` = position in the stored array
    expect(a.dormant).toEqual([]);
    expect(a.invalid).toEqual([]);
  });
  it.each([
    ["unknown type", { id: "x", type: "carousel", props: {} }, "unsupported_type"],
    ["invalid props", { id: "x", type: "richText", props: { title: 1 } }, "invalid_props"],
    ["not an object", 5, "invalid_envelope"],
  ])("flags %s without dropping it", (_n, raw, reason) => {
    const a = analyzePage([ok, raw], rules);
    expect(a.sections).toEqual([ok]);
    expect(a.invalid).toEqual([{ index: 1, reason, raw }]);
  });
  it("a valid section that this theme does not approve is DORMANT: kept verbatim in its position, never invalid", () => {
    const wrong = { id: "w", type: "productGrid", props: { title: "t" } };
    const theirs = { id: "o", type: "coffee.openingHours", props: { title: "t", body: "", note: "" } };
    const a = analyzePage([ok, wrong, theirs], rules);
    expect(a.invalid).toEqual([]);
    expect(a.sections).toEqual([ok]);
    expect(a.dormant.map((d) => d.section.id)).toEqual(["w", "o"]);
    expect(a.entries.map((e) => e.kind)).toEqual(["active", "dormant", "dormant"]);
    expect(a.dormant[0]!.raw).toBe(wrong); // the stored value itself, not a re-serialised copy
  });
  it("flags duplicate ids and extra copies of a singleton", () => {
    expect(analyzePage([ok, ok], rules).invalid.map((i) => i.reason)).toEqual(["invalid_envelope"]);
    const contact = generalTemplate.editor.pages.CONTACT;
    const ci = (id: string) => ({ id, type: "contactInfo", props: { title: "t", body: "" } });
    expect(analyzePage([ci("a"), ci("b")], contact).invalid.map((i) => i.reason)).toEqual(["duplicate_singleton"]);
  });
  it.each([null, undefined, {}, "x", 5])("a stored %j is one not_an_array issue carrying the raw value", (raw) => {
    expect(analyzePage(raw, rules)).toEqual({ entries: [], sections: [], dormant: [], invalid: [{ index: -1, reason: "not_an_array", raw }] });
  });
  it("does not mutate its input", () => {
    const input = [ok, { id: "x", type: "carousel", props: {} }];
    const copy = JSON.stringify(input);
    analyzePage(input, rules);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe("appearance settings", () => {
  const base = { primaryColor: "#112233", direction: "rtl", contact: { phone: "", email: "", address: "" }, social: { instagram: "", telegram: "", whatsapp: "" } };
  it("settings stored before typography existed parse with the defaults", () => {
    expect(templateSettingsSchema.parse(base).typography).toEqual(DEFAULT_TYPOGRAPHY);
  });
  it("typography is a closed set: fixed font, listed sizes and weights only, no extra keys", () => {
    expect(typographySchema.safeParse({ fontFamily: "vazirmatn", sizeScale: "large", headingWeight: 600, bodyWeight: 500 }).success).toBe(true);
    for (const bad of [
      { ...DEFAULT_TYPOGRAPHY, fontFamily: "Arial" },
      { ...DEFAULT_TYPOGRAPHY, fontFamily: "url(https://evil.example/x.woff)" },
      { ...DEFAULT_TYPOGRAPHY, sizeScale: "20px" },
      { ...DEFAULT_TYPOGRAPHY, headingWeight: 900 },
      { ...DEFAULT_TYPOGRAPHY, bodyWeight: 300 },
      { ...DEFAULT_TYPOGRAPHY, lineHeight: 2 },
    ]) expect(typographySchema.safeParse(bad).success).toBe(false);
  });
  it.each(["#000000", "#ABCDEF", "#0f766e"])("accepts the HEX color %s", (c) => expect(hexColorSchema.safeParse(c).success).toBe(true));
  it.each(["red", "#fff", "#12345678", "rgb(1,2,3)", "#xyzxyz", "url(x)", "#123456 ", "expression(1)", "#12345g"])("rejects the color %j", (c) =>
    expect(hexColorSchema.safeParse(c).success).toBe(false),
  );
});
