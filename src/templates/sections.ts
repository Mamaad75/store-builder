import { z } from "zod";

/** Whitelisted section types. Per-type props schemas are added with the renderer (step 7). */
export const SECTION_TYPES = [
  "hero",
  "featuredProducts",
  "productGrid",
  "categoryFilter",
  "productDetail",
  "richText",
  "imageText",
  "contactInfo",
  "callToAction",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export const PAGE_TYPES = ["HOME", "PRODUCTS", "PRODUCT_DETAIL", "ABOUT", "CONTACT"] as const;

export const sectionEnvelopeSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(SECTION_TYPES),
  props: z.record(z.string(), z.unknown()),
});

export const pageDefinitionSchema = z.object({
  type: z.enum(PAGE_TYPES),
  title: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
  sections: z.array(sectionEnvelopeSchema),
});

export const templateSettingsSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  direction: z.enum(["rtl", "ltr"]),
  contact: z.object({ phone: z.string(), email: z.string(), address: z.string() }),
  social: z.object({ instagram: z.string(), telegram: z.string(), whatsapp: z.string() }),
});

export type PageDefinition = z.infer<typeof pageDefinitionSchema>;
export type TemplateSettings = z.infer<typeof templateSettingsSchema>;
