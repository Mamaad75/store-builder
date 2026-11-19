import { z } from "zod";
import type { EditorSpec } from "../editor";
import type { SectionDefinition, ThemeDefinition } from "../theme";

const title = z.string().min(1).max(120);

/**
 * Theme-specific section of the appliances theme: warranty / delivery / after-sales points, one per line
 * ("title: text"). Plain text only (rendered as escaped React text), at most 14 lines are shown.
 */
export const serviceInfoSection: SectionDefinition = {
  type: "appliances.serviceInfo",
  label: "گارانتی و خدمات",
  schema: z.object({ title, items: z.string().max(1200), note: z.string().max(200) }).strict() as unknown as SectionDefinition["schema"],
  defaults: {
    title: "گارانتی و خدمات پس از فروش",
    items: "گارانتی: کالاها با گارانتی معتبر عرضه می‌شوند\nارسال: ارسال به سراسر کشور با بسته‌بندی ایمن\nنصب و راه‌اندازی: راهنمایی تلفنی یا نصب در محل\nپشتیبانی: پاسخگویی در ساعات اداری",
    note: "",
  },
  fields: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "items", label: "موارد (هر خط یک مورد؛ «عنوان: توضیح»)", kind: "textarea", max: 1200 },
    { name: "note", label: "یادداشت", kind: "text", max: 200 },
  ],
  image: false,
};

const editor: EditorSpec = {
  pages: {
    HOME: {
      allowed: ["hero", "featuredProducts", "imageText", "richText", "callToAction", "contactInfo", "appliances.serviceInfo"],
      singletons: ["hero", "appliances.serviceInfo"],
      required: [],
    },
    PRODUCTS: {
      allowed: ["categoryFilter", "productGrid", "richText", "callToAction"],
      singletons: ["categoryFilter", "productGrid"],
      required: ["productGrid"],
    },
    PRODUCT_DETAIL: { allowed: ["productDetail"], singletons: ["productDetail"], required: ["productDetail"] },
    ABOUT: { allowed: ["richText", "imageText", "callToAction", "contactInfo", "appliances.serviceInfo"], singletons: ["appliances.serviceInfo"], required: [] },
    CONTACT: {
      allowed: ["contactInfo", "richText", "callToAction", "appliances.serviceInfo"],
      singletons: ["contactInfo", "appliances.serviceInfo"],
      required: ["contactInfo"],
    },
  },
};

export const appliancesTheme: ThemeDefinition = {
  key: "appliances",
  version: 1,
  meta: { name: "تمیز و کاتالوگی", description: "چیدمان شفاف و فنی با تصویر کامل محصول و جدول مشخصات؛ مناسب کالاهایی که مشخصات فنی دارند." },
  sectionDefinitions: [serviceInfoSection],
  editor,
};
