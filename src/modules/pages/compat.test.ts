import { describe, expect, it } from "vitest";
import { generalTheme } from "@/templates/general/definition";
import { coffeeTheme } from "@/templates/coffee/definition";
import { fashionTheme } from "@/templates/fashion/definition";
import type { EditorSpec } from "@/templates/editor";
import type { ThemeDefinition } from "@/templates/theme";
import { PAGE_TYPES, type PageType } from "@/templates/sections";
import { analyzePage } from "./analyze";
import { computeCompatibility, type PageInput } from "./compat";

const sec = (id: string, type: string, props: Record<string, unknown>) => ({ id, type, props });
const rich = (id: string) => sec(id, "richText", { title: "t", body: "b" });
const contact = (id: string) => sec(id, "contactInfo", { title: "تماس", body: "" });
const hours = (id: string) => sec(id, "coffee.openingHours", { title: "ساعت کاری", body: "همه روز", note: "" });
const hero = (id: string, imageId: string | null = null) => sec(id, "hero", { title: "h", subtitle: "", buttonText: "", buttonLink: "/", imageId });

const page = (type: PageType, sections: unknown, over: Partial<PageInput> = {}): PageInput => ({ type, title: type, isVisible: true, sections, ...over });
const full = (over: Partial<Record<PageType, unknown>> = {}): PageInput[] =>
  PAGE_TYPES.map((t) => page(t, over[t] ?? (t === "PRODUCTS" ? [sec("g", "productGrid", { title: "p" })] : t === "PRODUCT_DETAIL" ? [sec("d", "productDetail", {})] : t === "CONTACT" ? [contact("c")] : [])));

/** A copy of a theme with a changed editor spec (a stricter or differently shaped theme) - pure data, no registry involved. */
const variant = (base: ThemeDefinition, key: string, patch: Partial<Record<PageType, Partial<EditorSpec["pages"][PageType]>>>): ThemeDefinition => ({
  ...base,
  key,
  editor: { pages: Object.fromEntries(PAGE_TYPES.map((t) => [t, { ...base.editor.pages[t], ...patch[t] }])) as EditorSpec["pages"] },
});

const entry = (r: ReturnType<typeof computeCompatibility>, type: PageType, index: number) => r.pages.find((p) => p.type === type)!.entries.find((e) => e.index === index)!;

describe("computeCompatibility", () => {
  it("same theme: everything stays, nothing blocks", () => {
    const r = computeCompatibility(full({ ABOUT: [rich("a"), contact("b")] }), generalTheme, generalTheme);
    expect(r.canSwitch).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.summary).toMatchObject({ becomeDormant: 0, becomeActive: 0, newInvalid: 0, missingRequired: 0 });
    expect(r.pages.flatMap((p) => p.entries).every((e) => e.change === "stays_active")).toBe(true);
  });

  it("active -> dormant: a section the target does not approve is reported (with its position and id), not blocked", () => {
    const r = computeCompatibility(full({ ABOUT: [rich("a"), contact("b"), contact("c")] }), generalTheme, coffeeTheme);
    // coffee's ABOUT does not approve contactInfo
    expect(entry(r, "ABOUT", 0)).toMatchObject({ id: "a", change: "stays_active" });
    expect(entry(r, "ABOUT", 1)).toMatchObject({ id: "b", type: "contactInfo", from: "active", to: "dormant", change: "becomes_dormant", blocking: false });
    expect(entry(r, "ABOUT", 2)).toMatchObject({ id: "c", change: "becomes_dormant" });
    expect(r.summary.becomeDormant).toBe(2);
    expect(r.canSwitch).toBe(true);
  });

  it("dormant -> active: another theme's section reappears when the target approves it (no data involved)", () => {
    const r = computeCompatibility(full({ HOME: [hero("h"), hours("o")] }), generalTheme, coffeeTheme);
    expect(entry(r, "HOME", 1)).toMatchObject({ type: "coffee.openingHours", from: "dormant", to: "active", change: "becomes_active" });
    expect(r.summary.becomeActive).toBe(1);
  });

  it("stays dormant when neither theme approves it", () => {
    const r = computeCompatibility(full({ HOME: [hero("h"), hours("o")] }), generalTheme, fashionTheme);
    expect(entry(r, "HOME", 1)).toMatchObject({ from: "dormant", to: "dormant", change: "stays_dormant" });
  });

  it("images are flagged on the entry (informational: they are preserved either way)", () => {
    const r = computeCompatibility(full({ HOME: [hero("h", "media1"), contact("c")] }), generalTheme, coffeeTheme);
    expect(entry(r, "HOME", 0).hasImage).toBe(true);
    expect(entry(r, "HOME", 1).hasImage).toBe(false);
  });

  describe("invalid data: pre-existing never blocks, newly introduced always does", () => {
    it("PRE-EXISTING invalid entries (corrupt, unknown type, bad props, duplicate id) stay invalid and do not block", () => {
      const junk = [rich("a"), { nope: 1 }, sec("x", "unknownType", {}), sec("y", "richText", { title: 1 }), rich("a")];
      const r = computeCompatibility(full({ ABOUT: junk }), generalTheme, coffeeTheme);
      const kinds = r.pages.find((p) => p.type === "ABOUT")!.entries.map((e) => e.change);
      expect(kinds).toEqual(["stays_active", "stays_invalid", "stays_invalid", "stays_invalid", "stays_invalid"]);
      expect(r.summary.preExistingInvalid).toBe(4);
      expect(r.summary.newInvalid).toBe(0);
      expect(r.canSwitch).toBe(true);
      expect(r.blockers).toEqual([]);
    });

    it("a page whose stored value is not an array at all is pre-existing invalid (index -1), unless the target also needs a section it lacks", () => {
      const r = computeCompatibility(full({ ABOUT: { oops: true } }), generalTheme, coffeeTheme);
      expect(r.pages.find((p) => p.type === "ABOUT")!.entries).toMatchObject([{ index: -1, change: "stays_invalid", reason: "not_an_array" }]);
      expect(r.canSwitch).toBe(true); // ABOUT requires nothing
    });

    it("NEW invalid state: an extra copy of a type the target treats as a singleton BLOCKS and is reported per section", () => {
      const strict = variant(generalTheme, "strict", { ABOUT: { singletons: ["richText"] } });
      const r = computeCompatibility(full({ ABOUT: [rich("a"), rich("b"), rich("c")] }), generalTheme, strict);
      expect(entry(r, "ABOUT", 0).change).toBe("stays_active"); // the first copy stays
      expect(entry(r, "ABOUT", 1)).toMatchObject({ change: "becomes_invalid", reason: "duplicate_singleton", blocking: true });
      expect(entry(r, "ABOUT", 2)).toMatchObject({ change: "becomes_invalid", blocking: true });
      expect(r.summary.newInvalid).toBe(2);
      expect(r.canSwitch).toBe(false);
      expect(r.blockers).toEqual([
        { kind: "new_invalid", pageType: "ABOUT", index: 1, sectionType: "richText", reason: "duplicate_singleton" },
        { kind: "new_invalid", pageType: "ABOUT", index: 2, sectionType: "richText", reason: "duplicate_singleton" },
      ]);
    });

    it("pre-existing and new problems are told apart in one page", () => {
      const strict = variant(generalTheme, "strict", { ABOUT: { singletons: ["richText"] } });
      const r = computeCompatibility(full({ ABOUT: [rich("a"), { broken: true }, rich("b")] }), generalTheme, strict);
      expect(entry(r, "ABOUT", 1).change).toBe("stays_invalid");
      expect(entry(r, "ABOUT", 2).change).toBe("becomes_invalid");
      expect(r.blockers).toHaveLength(1);
    });

    it("an entry invalid only because of the CURRENT theme's singleton rule becomes valid in a looser target (reported, not blocking)", () => {
      const strict = variant(generalTheme, "strict", { ABOUT: { singletons: ["richText"] } });
      const r = computeCompatibility(full({ ABOUT: [rich("a"), rich("b")] }), strict, generalTheme);
      expect(entry(r, "ABOUT", 1)).toMatchObject({ from: "invalid", to: "active", change: "invalid_becomes_active", blocking: false });
      expect(r.canSwitch).toBe(true);
    });

    it("a dormant extra copy that would collide with the target's singleton rule is a NEW invalid state", () => {
      // two coffee.openingHours exist (dormant under general); coffee treats it as a singleton on HOME
      const r = computeCompatibility(full({ HOME: [hero("h"), hours("o1"), hours("o2")] }), generalTheme, coffeeTheme);
      expect(entry(r, "HOME", 1).change).toBe("becomes_active");
      expect(entry(r, "HOME", 2)).toMatchObject({ from: "dormant", to: "invalid", change: "becomes_invalid", blocking: true });
      expect(r.canSwitch).toBe(false);
    });
  });

  describe("required sections", () => {
    const needsCta = variant(generalTheme, "needs-cta", { HOME: { required: ["callToAction"] } });

    it("a required type the page has no active copy of is reported on the page and BLOCKS", () => {
      const r = computeCompatibility(full({ HOME: [hero("h")] }), generalTheme, needsCta);
      expect(r.pages.find((p) => p.type === "HOME")!.missingRequired).toEqual([{ type: "callToAction", alsoMissingNow: false }]);
      expect(r.blockers).toEqual([{ kind: "missing_required", pageType: "HOME", sectionType: "callToAction" }]);
      expect(r.summary.missingRequired).toBe(1);
      expect(r.canSwitch).toBe(false);
    });

    it("satisfied by an existing active copy, or by a dormant copy that becomes active in the target", () => {
      const cta = sec("c", "callToAction", { title: "t", buttonText: "ok", buttonLink: "/" });
      expect(computeCompatibility(full({ HOME: [hero("h"), cta] }), generalTheme, needsCta).canSwitch).toBe(true);
      const onlyAboutHasIt = variant(generalTheme, "no-cta-home", { HOME: { allowed: ["hero", "featuredProducts", "imageText", "richText"] } });
      const r = computeCompatibility(full({ HOME: [hero("h"), cta] }), onlyAboutHasIt, needsCta);
      expect(entry(r, "HOME", 1).change).toBe("becomes_active");
      expect(r.canSwitch).toBe(true);
    });

    it("a page that already lacks a section the CURRENT theme requires is still blocked, and says so", () => {
      const r = computeCompatibility(full({ PRODUCTS: [] }), generalTheme, coffeeTheme);
      expect(r.pages.find((p) => p.type === "PRODUCTS")!.missingRequired).toEqual([{ type: "productGrid", alsoMissingNow: true }]);
      expect(r.canSwitch).toBe(false);
    });

    it("hidden pages are checked too (they come back when shown again)", () => {
      const r = computeCompatibility(full({ HOME: [hero("h")] }).map((p) => (p.type === "HOME" ? { ...p, isVisible: false } : p)), generalTheme, needsCta);
      expect(r.canSwitch).toBe(false);
    });
  });

  it("does not modify its input (pure)", () => {
    const input = full({ ABOUT: [rich("a"), contact("b"), { broken: true }] });
    const before = JSON.stringify(input);
    computeCompatibility(input, generalTheme, coffeeTheme);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("agrees with analyzePage for every entry of every real theme pair (the report cannot disagree with the editor)", () => {
    const themes = [generalTheme, coffeeTheme, fashionTheme];
    const sections = [hero("h"), rich("r"), contact("c"), hours("o"), sec("s", "fashion.sizeGuide", { title: "t", intro: "", table: "", note: "" }), { junk: 1 }, sec("u", "nope", {})];
    const inputs = PAGE_TYPES.map((t) => page(t, sections));
    for (const from of themes) {
      for (const to of themes) {
        const r = computeCompatibility(inputs, from, to);
        for (const p of r.pages) {
          const a = analyzePage(sections, to.editor.pages[p.type]);
          const activeIdx = a.entries.filter((e) => e.kind === "active").map((e) => e.index);
          const dormantIdx = a.entries.filter((e) => e.kind === "dormant").map((e) => e.index);
          const invalidIdx = a.invalid.map((i) => i.index);
          expect(p.entries.filter((e) => e.to === "active").map((e) => e.index), `${from.key}->${to.key} ${p.type}`).toEqual(activeIdx);
          expect(p.entries.filter((e) => e.to === "dormant").map((e) => e.index)).toEqual(dormantIdx);
          expect(p.entries.filter((e) => e.to === "invalid").map((e) => e.index)).toEqual(invalidIdx);
        }
      }
    }
  });
});
