import { z } from "zod";
import type { EditorSpec } from "../editor";
import type { SectionDefinition, ThemeDefinition } from "../theme";

const title = z.string().min(1).max(120);

/** Theme-specific section of the fashion theme: a size table (one row per line, columns separated by `|`). */
export const sizeGuideSection: SectionDefinition = {
  type: "fashion.sizeGuide",
  label: "راهنمای سایز",
  schema: z.object({ title, intro: z.string().max(300), table: z.string().max(1500), note: z.string().max(300) }).strict() as unknown as SectionDefinition["schema"],
  defaults: {
    title: "راهنمای سایز",
    intro: "اندازه‌ها بر حسب سانتی‌متر است.",
    table: "سایز | دور سینه | دور کمر\nS | 88 | 72\nM | 94 | 78\nL | 100 | 84",
    note: "",
  },
  fields: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "intro", label: "توضیح کوتاه", kind: "textarea", max: 300 },
    { name: "table", label: "جدول (هر خط یک ردیف؛ ستون‌ها با | جدا شوند، خط اول سرستون)", kind: "textarea", max: 1500 },
    { name: "note", label: "یادداشت", kind: "text", max: 300 },
  ],
  image: false,
};

const editor: EditorSpec = {
  pages: {
    HOME: { allowed: ["hero", "featuredProducts", "imageText", "richText", "callToAction"], singletons: ["hero"], required: [] },
    PRODUCTS: {
      allowed: ["categoryFilter", "productGrid", "richText", "callToAction", "fashion.sizeGuide"],
      singletons: ["categoryFilter", "productGrid", "fashion.sizeGuide"],
      required: ["productGrid"],
    },
    PRODUCT_DETAIL: { allowed: ["productDetail"], singletons: ["productDetail"], required: ["productDetail"] },
    ABOUT: { allowed: ["richText", "imageText", "callToAction", "contactInfo", "fashion.sizeGuide"], singletons: ["fashion.sizeGuide"], required: [] },
    CONTACT: { allowed: ["contactInfo", "richText", "callToAction"], singletons: ["contactInfo"], required: ["contactInfo"] },
  },
};

export const fashionTheme: ThemeDefinition = {
  key: "fashion",
  version: 1,
  meta: { name: "مینیمال و مدرن", description: "فضای سفید زیاد، تصویر محصول در مرکز توجه و تایپوگرافی ظریف." },
  sectionDefinitions: [sizeGuideSection],
  editor,
};
