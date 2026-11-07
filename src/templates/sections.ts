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

const sectionIdSchema = z.string().min(1).max(40);

/** Persisted-JSON envelope. Props are validated against the schema of their type. */
export const sectionEnvelopeSchema = z
  .object({
    id: sectionIdSchema,
    type: z.enum(SECTION_TYPES),
    props: z.record(z.string(), z.unknown()),
  })
  .superRefine((section, ctx) => {
    const r = sectionPropsSchemas[section.type].safeParse(section.props);
    if (!r.success) {
      for (const issue of r.error.issues) ctx.addIssue({ code: "custom", path: ["props", ...issue.path], message: issue.message });
    }
  });

export type SectionIssueReason = "not_an_array" | "invalid_envelope" | "unsupported_type" | "invalid_props";

export interface SectionIssue {
  index: number;
  id?: string;
  type?: string;
  reason: SectionIssueReason;
}

export type ParsedSection = { ok: true; section: Section } | { ok: false; issue: Omit<SectionIssue, "index"> };

/** Validates ONE persisted section. Never throws, whatever the input is. */
export function parseSection(raw: unknown): ParsedSection {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, issue: { reason: "invalid_envelope" } };
  const { id, type, props } = raw as Record<string, unknown>;
  const idr = sectionIdSchema.safeParse(id);
  if (!idr.success || typeof type !== "string") return { ok: false, issue: { reason: "invalid_envelope" } };
  if (!(SECTION_TYPES as readonly string[]).includes(type)) return { ok: false, issue: { reason: "unsupported_type", id: idr.data, type } };
  const t = type as SectionType;
  if (typeof props !== "object" || props === null || Array.isArray(props)) return { ok: false, issue: { reason: "invalid_props", id: idr.data, type } };
  const pr = sectionPropsSchemas[t].safeParse(props);
  if (!pr.success) return { ok: false, issue: { reason: "invalid_props", id: idr.data, type } };
  return { ok: true, section: { id: idr.data, type: t, props: pr.data } as Section };
}

/**
 * Validates a persisted `sections` array. Invalid sections are SKIPPED (and reported as issues); the
 * stored data is never modified or deleted by rendering.
 */
export function parseSections(raw: unknown): { sections: Section[]; issues: SectionIssue[] } {
  if (!Array.isArray(raw)) return { sections: [], issues: [{ index: -1, reason: "not_an_array" }] };
  const sections: Section[] = [];
  const issues: SectionIssue[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const r = parseSection(item);
    if (!r.ok) issues.push({ index, ...r.issue });
    else if (seen.has(r.section.id)) issues.push({ index, id: r.section.id, type: r.section.type, reason: "invalid_envelope" });
    else {
      seen.add(r.section.id);
      sections.push(r.section);
    }
  });
  return { sections, issues };
}

export const pageDefinitionSchema = z.object({
  type: z.enum(PAGE_TYPES),
  title: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
  sections: z.array(sectionEnvelopeSchema),
});

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

export type PageDefinition = z.infer<typeof pageDefinitionSchema>;
export type TemplateSettings = z.infer<typeof templateSettingsSchema>;
/** Settings as written by a seed/definition (typography optional). */
export type TemplateSettingsInput = z.input<typeof templateSettingsSchema>;
