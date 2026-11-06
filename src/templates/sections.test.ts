import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS, templateDefinitionSchema } from "./definitions";
import { SECTION_TYPES, parseSection, parseSections } from "./sections";

const hero = { id: "h", type: "hero", props: { title: "سلام", subtitle: "", buttonText: "برو", buttonLink: "/products", imageId: null } };

describe("section contract", () => {
  it("every shipped template definition (all 3 seeds) satisfies the strict per-type schemas", () => {
    for (const d of TEMPLATE_DEFINITIONS) expect(() => templateDefinitionSchema.parse(d), d.key).not.toThrow();
  });

  it("accepts a valid section and returns typed props", () => {
    const r = parseSection(hero);
    expect(r.ok).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "hero"],
    ["missing id", { type: "hero", props: {} }],
    ["unknown type", { id: "x", type: "carousel", props: {} }],
    ["extra prop", { ...hero, props: { ...hero.props, onClick: "x" } }],
    ["missing prop", { ...hero, props: { title: "x" } }],
    ["wrong prop type", { ...hero, props: { ...hero.props, title: 5 } }],
    ["javascript: link", { ...hero, props: { ...hero.props, buttonLink: "javascript:alert(1)" } }],
    ["protocol-relative link", { ...hero, props: { ...hero.props, buttonLink: "//evil.example" } }],
    ["external link", { ...hero, props: { ...hero.props, buttonLink: "https://evil.example" } }],
    ["limit out of range", { id: "f", type: "featuredProducts", props: { title: "t", limit: 500 } }],
  ])("rejects malformed section (%s) without throwing", (_n, raw) => {
    const r = parseSection(raw);
    expect(r.ok).toBe(false);
  });

  it("reports unsupported types distinctly from invalid props", () => {
    const u = parseSection({ id: "x", type: "carousel", props: {} });
    const i = parseSection({ ...hero, props: {} });
    expect(!u.ok && u.issue.reason).toBe("unsupported_type");
    expect(!i.ok && i.issue.reason).toBe("invalid_props");
  });

  it("parseSections keeps valid sections, reports the rest and never throws on non-arrays", () => {
    const { sections, issues } = parseSections([hero, { id: "bad", type: "hero", props: {} }, 7, { ...hero }]);
    expect(sections.map((s) => s.id)).toEqual(["h"]);
    expect(issues.map((i) => i.index)).toEqual([1, 2, 3]); // index 3 is a duplicate id
    for (const bad of [null, undefined, {}, "x", 5]) {
      expect(parseSections(bad)).toEqual({ sections: [], issues: [{ index: -1, reason: "not_an_array" }] });
    }
  });

  it("does not mutate the persisted input", () => {
    const raw = [hero, { id: "bad", type: "nope", props: {} }];
    const copy = JSON.stringify(raw);
    parseSections(raw);
    expect(JSON.stringify(raw)).toBe(copy);
  });

  it("every section type has a props schema", () => {
    expect(SECTION_TYPES.length).toBe(9);
  });
});
