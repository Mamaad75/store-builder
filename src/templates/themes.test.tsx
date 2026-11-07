import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TEMPLATE_DEFINITIONS } from "./definitions";
import { coffeeTemplate } from "./coffee";
import { fashionTemplate } from "./fashion";
import { generalTemplate } from "./general";
import { listRegisteredTemplates, resolveTemplate } from "./registry";
import { getSectionDefinition, isCoreSectionType, listSectionDefinitions, defaultPropsOf } from "./section-registry";
import { parseSection, parseSections, pageDefinitionSchema } from "./section-parse";
import { PAGE_TYPES, SECTION_TYPES } from "./sections";
import { THEME_CATALOG, allThemes, resolveThemeDefinition, setExtraThemesForTests } from "./theme-catalog";
import { EXTRA_SECTION_TYPE_RE } from "./theme";
import { parseLabelLines, parseTable } from "./engine/lines";
import { makeStorefront } from "@/test/storefront-fixtures";
import { buildView } from "./engine/view";

const MODULES = [generalTemplate, coffeeTemplate, fashionTemplate];

describe("theme catalog and module registry stay in sync", () => {
  it("every catalog theme has exactly one React module and vice versa", () => {
    expect(THEME_CATALOG.map((t) => `${t.key}@${t.version}`).sort()).toEqual(listRegisteredTemplates().map((t) => `${t.key}@${t.version}`).sort());
    for (const t of THEME_CATALOG) {
      const m = resolveTemplate(t.key, t.version);
      expect(m?.definition, t.key).toBe(t);
    }
  });
  it("the three version 1 themes exist and keep their identity (immutable)", () => {
    expect(THEME_CATALOG.map((t) => [t.key, t.version])).toEqual([["general", 1], ["coffee", 1], ["fashion", 1]]);
  });
  it("theme metadata describes a visual direction, not a business category", () => {
    for (const t of THEME_CATALOG) {
      expect(t.meta.name.length).toBeGreaterThan(0);
      expect(t.meta.description.length).toBeGreaterThan(0);
    }
    expect(THEME_CATALOG.map((t) => t.meta.name)).toEqual(["ساده و همه‌منظوره", "گرم و ادیتوریال", "مینیمال و مدرن"]);
  });
});

describe.each(MODULES)("theme contract: $key@$version", (m) => {
  it("implements EVERY core section type (so content is portable between themes)", () => {
    for (const t of SECTION_TYPES) expect(m.sections[t], t).toBeTypeOf("function");
  });
  it("brings a component for every theme-specific section it defines, and no stray ones", () => {
    expect(Object.keys(m.extraSections).sort()).toEqual(m.definition.sectionDefinitions.map((d) => d.type).sort());
    for (const d of m.definition.sectionDefinitions) {
      expect(d.type.startsWith(`${m.key}.`), `${d.type} must be namespaced by THEME ${m.key}`).toBe(true);
      expect(EXTRA_SECTION_TYPE_RE.test(d.type)).toBe(true);
    }
  });
  it("its editor spec covers every page, only approves renderable sections, and is internally consistent", () => {
    expect(Object.keys(m.editor.pages).sort()).toEqual([...PAGE_TYPES].sort());
    for (const page of PAGE_TYPES) {
      const r = m.editor.pages[page];
      for (const t of r.allowed) {
        expect(getSectionDefinition(t), `${page}: ${t} is not in the registry`).not.toBeNull();
        const renderable = isCoreSectionType(t) ? m.sections[t] : m.extraSections[t];
        expect(renderable, `${page}: ${t} has no component in ${m.key}`).toBeTypeOf("function");
      }
      for (const t of [...r.singletons, ...r.required]) expect(r.allowed, `${page}: ${t}`).toContain(t);
    }
  });
  it("the product listing and product detail structure is always available (required sections)", () => {
    expect(m.editor.pages.PRODUCTS.required).toContain("productGrid");
    expect(m.editor.pages.PRODUCT_DETAIL.required).toContain("productDetail");
    expect(m.editor.pages.CONTACT.required).toContain("contactInfo");
  });
  it("renders every page type of a complete storefront without throwing (typography and colour variables applied)", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: StorefrontRenderer } = await import("./engine/StorefrontRenderer");
    const data = makeStorefront({ template: { key: m.key, version: m.version } });
    data.store.typography = { fontFamily: "vazirmatn", sizeScale: "large", headingWeight: 700, bodyWeight: 500 };
    data.store.primaryColor = "#0f766e";
    for (const segs of [[], ["products"], ["products", data.products[0]!.slug], ["about"], ["contact"]]) {
      const v = buildView(data, { basePath: "/p", segments: segs });
      if (v.status !== "ok") throw new Error(`${m.key}: ${v.status}`);
      const html = renderToStaticMarkup(<StorefrontRenderer template={v.template} ctx={v.ctx} />);
      expect(html, segs.join("/")).toContain('dir="rtl"');
      expect(html).toContain(`data-template="${m.key}"`);
      expect(html).toContain("font-size:110%");
      expect(html).toContain("--w-heading:700");
      expect(html).toContain("--w-body:500");
      expect(html).toContain("--primary:#0f766e");
      expect(html.match(/<h1[ >]/g), `${m.key} ${segs.join("/")} needs exactly one h1`).toHaveLength(1);
      expect(html).toContain('href="#main"');
      expect(html).not.toMatch(/font-family/);
    }
  });
});

describe("section registry (global, theme-independent validation)", () => {
  it("knows every core type and each theme's extra types exactly once", () => {
    const types = listSectionDefinitions().map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    for (const t of SECTION_TYPES) expect(types).toContain(t);
    expect(types).toContain("coffee.openingHours");
    expect(types).toContain("fashion.sizeGuide");
  });
  it("every definition's defaults satisfy its own strict schema", () => {
    for (const d of listSectionDefinitions()) expect(() => defaultPropsOf(d.type), d.type).not.toThrow();
  });
  it("every form field of every definition maps to a real prop, and image fields are never form fields", () => {
    for (const d of listSectionDefinitions()) {
      const shape = Object.keys((d.schema as unknown as { shape: Record<string, unknown> }).shape);
      for (const f of d.fields) {
        expect(shape, `${d.type}.${f.name}`).toContain(f.name);
        expect(f.name).not.toBe("imageId");
      }
      const covered = new Set([...d.fields.map((f) => f.name), "imageId"]);
      for (const k of shape) expect(covered.has(k), `${d.type}.${k} is not editable`).toBe(true);
    }
  });
  it("does not resolve prototype keys or unknown types", () => {
    for (const t of ["__proto__", "constructor", "toString", "nothing.here", ""]) expect(getSectionDefinition(t)).toBeNull();
  });
  it("section types are namespaced by theme: no business-category names appear in any type", () => {
    for (const d of listSectionDefinitions()) expect(d.type).not.toMatch(/coffee-food|home-appliances/);
  });
});

describe("parseSection with theme-specific sections", () => {
  const hours = { id: "h1", type: "coffee.openingHours", props: { title: "ساعت کاری", body: "شنبه: ۸ تا ۲۲", note: "" } };
  const guide = { id: "g1", type: "fashion.sizeGuide", props: { title: "راهنما", intro: "", table: "سایز | سینه\nS | 90", note: "" } };
  it("validates extras by their own strict schema, whatever theme is active", () => {
    expect(parseSection(hours).ok).toBe(true);
    expect(parseSection(guide).ok).toBe(true);
  });
  it.each([
    ["unknown namespaced type", { id: "x", type: "coffee.nothing", props: {} }, "unsupported_type"],
    ["extra prop", { ...hours, props: { ...hours.props, onClick: "x" } }, "invalid_props"],
    ["missing prop", { ...hours, props: { title: "t" } }, "invalid_props"],
    ["title too long", { ...hours, props: { ...hours.props, title: "x".repeat(121) } }, "invalid_props"],
    ["table too long", { ...guide, props: { ...guide.props, table: "x".repeat(1501) } }, "invalid_props"],
  ])("rejects %s", (_n, raw, reason) => {
    const r = parseSection(raw);
    expect(!r.ok && r.issue.reason).toBe(reason);
  });
  it("parseSections keeps extras and reports invalid ones", () => {
    const { sections, issues } = parseSections([hours, { id: "x", type: "coffee.nothing", props: {} }, guide]);
    expect(sections.map((s) => s.id)).toEqual(["h1", "g1"]);
    expect(issues.map((i) => i.reason)).toEqual(["unsupported_type"]);
  });
  it("seed definitions of all three version 1 themes still validate against the registry (unchanged)", () => {
    for (const d of TEMPLATE_DEFINITIONS) expect(() => z.array(pageDefinitionSchema).parse(d.pages), d.key).not.toThrow();
  });
});

describe("pure text parsers of theme-specific sections", () => {
  it("parseLabelLines splits at the first colon, tolerates plain lines, caps rows", () => {
    expect(parseLabelLines("شنبه: ۸ تا ۲۲\nفقط متن\nجمعه：۹")).toEqual([
      { label: "شنبه", value: "۸ تا ۲۲" },
      { label: "", value: "فقط متن" },
      { label: "جمعه", value: "۹" },
    ]);
    expect(parseLabelLines(Array.from({ length: 30 }, (_, i) => `a${i}: b`).join("\n"))).toHaveLength(14);
  });
  it("parseTable builds a header and padded rows, caps size, and returns null without data rows", () => {
    expect(parseTable("سایز | سینه | کمر\nS | 90")).toEqual({ head: ["سایز", "سینه", "کمر"], rows: [["S", "90", ""]] });
    expect(parseTable("only header")).toBeNull();
    const big = parseTable(Array.from({ length: 40 }, () => "a|b|c|d|e|f|g|h").join("\n"))!;
    expect(big.rows.length).toBe(12);
    expect(big.head.length).toBe(6);
  });
  it("output is plain data: markup in the stored text stays text", () => {
    expect(parseLabelLines("<b>x</b>: <script>alert(1)</script>")[0]).toEqual({ label: "<b>x</b>", value: "<script>alert(1)</script>" });
  });
});

describe("theme-specific sections render safely", () => {
  it("coffee opening hours and fashion size guide render escaped text and are skipped by themes that do not implement them", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: StorefrontRenderer } = await import("./engine/StorefrontRenderer");
    const evil = '<img src=x onerror=alert(1)>';
    const data = makeStorefront({ template: { key: "coffee", version: 1 } });
    const about = data.pages.find((p) => p.type === "ABOUT")!;
    about.sections = [
      ...about.sections,
      { id: "h1", type: "coffee.openingHours", props: { title: evil, body: `${evil}: ${evil}`, note: evil } },
      { id: "g1", type: "fashion.sizeGuide", props: { title: "x", intro: "", table: "a | b\n1 | 2", note: "" } },
    ];
    const render = (key: string) => {
      const d = { ...data, template: { key, version: 1 } };
      const v = buildView(d, { basePath: "/p", segments: ["about"] });
      if (v.status !== "ok") throw new Error(v.status);
      return renderToStaticMarkup(<StorefrontRenderer template={v.template} ctx={v.ctx} />);
    };
    const coffee = render("coffee");
    expect(coffee).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(coffee).not.toContain("<img src=x");
    expect(coffee).not.toContain("<table"); // coffee has no size guide component: skipped, not a crash
    const fashion = render("fashion");
    expect(fashion).toContain("<table");
    expect(fashion).not.toContain("alert(1)"); // fashion has no opening hours component
    const general = render("general");
    expect(general).not.toContain("<table");
    expect(general).not.toContain("onerror");
  });
});

describe("adding a theme needs no change to the core (test seam)", () => {
  it("an extra theme definition contributes section types and is resolvable; clearing restores the catalog", () => {
    const fake = { key: "mini", version: 1, meta: { name: "m", description: "d" }, sectionDefinitions: [], editor: generalTemplate.editor };
    setExtraThemesForTests([fake]);
    expect(resolveThemeDefinition("mini", 1)).toBe(fake);
    expect(allThemes()).toHaveLength(THEME_CATALOG.length + 1);
    setExtraThemesForTests([]);
    expect(resolveThemeDefinition("mini", 1)).toBeNull();
    expect(allThemes()).toBe(THEME_CATALOG);
  });
  it("a theme cannot define a section type outside its own namespace (rejected when the registry is built)", () => {
    const bad = { key: "mini", version: 1, meta: { name: "m", description: "d" }, sectionDefinitions: [{ type: "other.thing", label: "x", schema: z.object({}).strict(), defaults: {}, fields: [], image: false }], editor: generalTemplate.editor };
    setExtraThemesForTests([bad as never]);
    expect(() => getSectionDefinition("other.thing")).toThrow(/invalid theme section type/);
    setExtraThemesForTests([]);
  });
});
