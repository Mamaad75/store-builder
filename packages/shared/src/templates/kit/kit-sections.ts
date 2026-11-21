import { z } from "zod";
import type { EditorSpec, PageEditorRules } from "../editor.js";
import type { SectionDefinition, ThemeDefinition, ThemeMeta } from "../theme.js";

/**
 * Pure building blocks shared by the "kit" themes (bazaar, circuit, sormeh, dookht, arcade, sofreh, golkhaneh, khaneh).
 * Every factory returns a section type NAMESPACED BY ITS THEME (`<key>.categories`), as the section registry requires; the
 * React side renders them with the shared kit components and the theme's own CSS module. All text is plain text, rendered
 * as escaped React text.
 */

const title = z.string().min(1).max(120);
const optionalTitle = z.string().max(120);
const schema = (shape: z.ZodRawShape) => z.object(shape).strict() as unknown as SectionDefinition["schema"];

/** The store's own categories as tiles (links to the filtered product list). Renders nothing while the store has none. */
export function categoriesSection(themeKey: string, defaultTitle = "دسته‌بندی‌ها"): SectionDefinition {
  return {
    type: `${themeKey}.categories`,
    label: "دسته‌بندی‌ها (کاشی)",
    schema: schema({ title: optionalTitle }),
    defaults: { title: defaultTitle },
    fields: [{ name: "title", label: "عنوان (خالی = بدون عنوان)", kind: "text", max: 120 }],
    image: false,
  };
}

/** Short points about the store, one per line ("عنوان: توضیح"); e.g. delivery, returns, support. At most 14 are shown. */
export function highlightsSection(themeKey: string, defaults: { title: string; items: string }): SectionDefinition {
  return {
    type: `${themeKey}.highlights`,
    label: "ویژگی‌های فروشگاه",
    schema: schema({ title: optionalTitle, items: z.string().max(1200) }),
    defaults,
    fields: [
      { name: "title", label: "عنوان (خالی = بدون عنوان)", kind: "text", max: 120 },
      { name: "items", label: "موارد (هر خط یک مورد؛ «عنوان: توضیح»)", kind: "textarea", max: 1200 },
    ],
    image: false,
  };
}

/** A titled list of "label: value" lines with an optional note (a cafe menu, opening hours, activation steps). */
export function linesSection(themeKey: string, name: string, label: string, itemsLabel: string, defaults: { title: string; items: string; note: string }): SectionDefinition {
  return {
    type: `${themeKey}.${name}`,
    label,
    schema: schema({ title, items: z.string().max(1200), note: z.string().max(200) }),
    defaults,
    fields: [
      { name: "title", label: "عنوان", kind: "text", max: 120 },
      { name: "items", label: itemsLabel, kind: "textarea", max: 1200 },
      { name: "note", label: "یادداشت", kind: "text", max: 200 },
    ],
    image: false,
  };
}

/** A highlighted band: title, one line of text and a short badge (e.g. a same-day delivery cut-off). */
export function noticeSection(themeKey: string, name: string, label: string, defaults: { title: string; body: string; badge: string }): SectionDefinition {
  return {
    type: `${themeKey}.${name}`,
    label,
    schema: schema({ title, body: z.string().max(300), badge: z.string().max(60) }),
    defaults,
    fields: [
      { name: "title", label: "عنوان", kind: "text", max: 120 },
      { name: "body", label: "متن", kind: "textarea", max: 300 },
      { name: "badge", label: "برچسب (خالی = بدون برچسب)", kind: "text", max: 60 },
    ],
    image: false,
  };
}

/** A size table ("a | b" per line, first line = header) with an intro and a note. */
export function sizeGuideSection(themeKey: string): SectionDefinition {
  return {
    type: `${themeKey}.sizeGuide`,
    label: "راهنمای سایز",
    schema: schema({ title, intro: z.string().max(500), table: z.string().max(1500), note: z.string().max(200) }),
    defaults: {
      title: "راهنمای سایز",
      intro: "اندازه‌ها به سانتی‌متر است. برای انتخاب درست، اندازه‌ی یک لباس مشابه را با جدول مقایسه کنید.",
      table: "سایز | دور سینه | قد\nS | ۹۰ | ۶۸\nM | ۹۶ | ۷۰\nL | ۱۰۲ | ۷۲\nXL | ۱۰۸ | ۷۴",
      note: "",
    },
    fields: [
      { name: "title", label: "عنوان", kind: "text", max: 120 },
      { name: "intro", label: "توضیح", kind: "textarea", max: 500 },
      { name: "table", label: "جدول (هر خط یک ردیف؛ ستون‌ها با |؛ خط اول عنوان ستون‌ها)", kind: "textarea", max: 1500 },
      { name: "note", label: "یادداشت", kind: "text", max: 200 },
    ],
    image: false,
  };
}

type Page = "HOME" | "PRODUCTS" | "ABOUT" | "CONTACT";

/** Where a theme's own extra sections may be placed. Every extra section of a kit theme is a singleton. */
export type ExtraPlacement = { def: SectionDefinition; pages: readonly Page[] };

const rules = (allowed: string[], singletons: string[], required: string[] = []): PageEditorRules => ({ allowed, singletons, required });

/**
 * The editor spec of a kit theme: the same core rules as the MVP themes, plus `<key>.categories` (home), `<key>.highlights`
 * (home, about, contact) and the theme's extra sections on the pages it names.
 */
export function kitEditor(themeKey: string, extras: readonly ExtraPlacement[]): EditorSpec {
  const cats = `${themeKey}.categories`;
  const hi = `${themeKey}.highlights`;
  const on = (page: Page) => extras.filter((e) => e.pages.includes(page)).map((e) => e.def.type);
  return {
    pages: {
      HOME: rules(["hero", cats, "featuredProducts", "imageText", "richText", "callToAction", "contactInfo", hi, ...on("HOME")], ["hero", cats, hi, ...on("HOME")]),
      PRODUCTS: rules(["categoryFilter", "productGrid", "richText", "callToAction", ...on("PRODUCTS")], ["categoryFilter", "productGrid", ...on("PRODUCTS")], ["productGrid"]),
      PRODUCT_DETAIL: rules(["productDetail"], ["productDetail"], ["productDetail"]),
      ABOUT: rules(["richText", "imageText", "callToAction", "contactInfo", hi, ...on("ABOUT")], [hi, ...on("ABOUT")]),
      CONTACT: rules(["contactInfo", "richText", "callToAction", hi, ...on("CONTACT")], ["contactInfo", hi, ...on("CONTACT")], ["contactInfo"]),
    },
  };
}

/** A complete kit theme definition (version 1): categories + highlights + the theme's extras. */
export function kitTheme(o: { key: string; meta: ThemeMeta; highlights: { title: string; items: string }; categoriesTitle?: string; extras?: readonly ExtraPlacement[] }): ThemeDefinition {
  const extras = o.extras ?? [];
  return {
    key: o.key,
    version: 1,
    meta: o.meta,
    sectionDefinitions: [categoriesSection(o.key, o.categoriesTitle), highlightsSection(o.key, o.highlights), ...extras.map((e) => e.def)],
    editor: kitEditor(o.key, extras),
  };
}
