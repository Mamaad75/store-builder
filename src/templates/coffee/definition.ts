import { z } from "zod";
import type { EditorSpec } from "../editor";
import type { SectionDefinition, ThemeDefinition } from "../theme";

const title = z.string().min(1).max(120);

/** Theme-specific section of the coffee theme: opening hours as plain lines ("شنبه تا چهارشنبه: ۸ تا ۲۲"). */
export const openingHoursSection: SectionDefinition = {
  type: "coffee.openingHours",
  label: "ساعت کاری",
  schema: z.object({ title, body: z.string().max(800), note: z.string().max(200) }).strict() as unknown as SectionDefinition["schema"],
  defaults: { title: "ساعت کاری", body: "شنبه تا چهارشنبه: ۸ تا ۲۲\nپنجشنبه و جمعه: ۹ تا ۲۳", note: "" },
  fields: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "body", label: "ساعت‌ها (هر خط یک مورد؛ «روز: ساعت»)", kind: "textarea", max: 800 },
    { name: "note", label: "یادداشت", kind: "text", max: 200 },
  ],
  image: false,
};

const editor: EditorSpec = {
  pages: {
    HOME: {
      allowed: ["hero", "featuredProducts", "imageText", "richText", "callToAction", "coffee.openingHours"],
      singletons: ["hero", "coffee.openingHours"],
      required: [],
    },
    PRODUCTS: { allowed: ["categoryFilter", "productGrid", "richText", "callToAction"], singletons: ["categoryFilter", "productGrid"], required: ["productGrid"] },
    PRODUCT_DETAIL: { allowed: ["productDetail"], singletons: ["productDetail"], required: ["productDetail"] },
    ABOUT: { allowed: ["richText", "imageText", "callToAction", "coffee.openingHours"], singletons: ["coffee.openingHours"], required: [] },
    CONTACT: { allowed: ["contactInfo", "richText", "callToAction", "coffee.openingHours"], singletons: ["contactInfo", "coffee.openingHours"], required: ["contactInfo"] },
  },
};

export const coffeeTheme: ThemeDefinition = {
  key: "coffee",
  version: 1,
  meta: { name: "گرم و ادیتوریال", description: "رنگ‌های گرم، تیتر درشت و کارت‌های منوگونه؛ برای فروشگاه‌هایی با حس داستان و کیفیت." },
  sectionDefinitions: [openingHoursSection],
  editor,
};
