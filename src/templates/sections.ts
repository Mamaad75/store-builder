import { z } from "zod";

/** Whitelisted section types. Each type has a strict props schema in `sectionPropsSchemas` below. */
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
export type PageType = (typeof PAGE_TYPES)[number];

/**
 * Internal links only: a path that starts with a single "/" and contains no whitespace, backslash,
 * quotes or angle brackets. Resolved against the storefront's base path at render time, so a section
 * can never link off-site or to a `javascript:` URL.
 */
export const internalPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\/(?!\/)[^\s\\<>"']*$/, "internal path expected");

const title = z.string().max(120);

/**
 * Strict props per section type. Unknown keys are rejected so a typo or a future field never
 * silently changes meaning. `imageId` is reserved for the media phase: it is validated as an opaque
 * id (or null) and the template shows a placeholder until media exists.
 */
export const sectionPropsSchemas = {
  hero: z
    .object({ title: title.min(1), subtitle: z.string().max(300), buttonText: z.string().max(40), buttonLink: internalPathSchema, imageId: z.string().max(64).nullable() })
    .strict(),
  featuredProducts: z.object({ title, limit: z.number().int().min(1).max(12) }).strict(),
  productGrid: z.object({ title }).strict(),
  categoryFilter: z.object({}).strict(),
  productDetail: z.object({}).strict(),
  richText: z.object({ title, body: z.string().max(5000) }).strict(),
  imageText: z.object({ title, body: z.string().max(3000), imageId: z.string().max(64).nullable() }).strict(),
  contactInfo: z.object({ title, body: z.string().max(1000) }).strict(),
  callToAction: z.object({ title: title.min(1), buttonText: z.string().max(40), buttonLink: internalPathSchema }).strict(),
} as const satisfies Record<SectionType, z.ZodType>;

export type SectionProps<T extends SectionType> = z.infer<(typeof sectionPropsSchemas)[T]>;

/** A validated section: `props` has the exact type for its `type`. */
export type Section = { [T in SectionType]: { id: string; type: T; props: SectionProps<T> } }[SectionType];

/**
 * Typography is a closed set of choices: the font family is fixed (Vazirmatn, bundled with the app) and sizes/weights come
 * from explicit allow-lists. There is deliberately no free-form family, URL or CSS value anywhere.
 */
export const TYPOGRAPHY_SIZE_SCALES = ["small", "normal", "large"] as const;
export const TYPOGRAPHY_HEADING_WEIGHTS = [600, 700, 800] as const;
export const TYPOGRAPHY_BODY_WEIGHTS = [400, 500] as const;

export const typographySchema = z
  .object({
    fontFamily: z.literal("vazirmatn"),
    sizeScale: z.enum(TYPOGRAPHY_SIZE_SCALES),
    headingWeight: z.union([z.literal(600), z.literal(700), z.literal(800)]),
    bodyWeight: z.union([z.literal(400), z.literal(500)]),
  })
  .strict();

export type Typography = z.infer<typeof typographySchema>;
export const DEFAULT_TYPOGRAPHY: Typography = { fontFamily: "vazirmatn", sizeScale: "normal", headingWeight: 800, bodyWeight: 400 };

/** Strict `#RRGGBB` only (no names, no short form, no alpha, no functions). */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const templateSettingsSchema = z.object({
  primaryColor: hexColorSchema,
  direction: z.enum(["rtl", "ltr"]),
  contact: z.object({ phone: z.string(), email: z.string(), address: z.string() }),
  social: z.object({ instagram: z.string(), telegram: z.string(), whatsapp: z.string() }),
  // Settings stored before phase 8 have no typography: they parse with the defaults (and are persisted normalised on the next save).
  typography: typographySchema.default(DEFAULT_TYPOGRAPHY),
});

export type TemplateSettings = z.infer<typeof templateSettingsSchema>;
/** Settings as written by a seed/definition (typography optional). */
export type TemplateSettingsInput = z.input<typeof templateSettingsSchema>;
