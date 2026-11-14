import { z } from "zod";
import { MAX_PRICE_TOMAN } from "@/lib/money";
import { MAX_SPEC_ROWS, specRowSchema } from "@/lib/product-specs";
import { MEDIA_KEY_RE } from "@/lib/storage/keys";
import { isCanonicalSlug } from "@/lib/text";
import { pageSectionSchema, type PageSection } from "./section-parse";
import { DEFAULT_TYPOGRAPHY, PAGE_TYPES, typographySchema } from "./sections";

/**
 * The ONE data contract a storefront is rendered from.
 *
 *  - Draft preview builds it from the live (draft) tables, owner-scoped.
 *  - The published storefront (phase 10) will store exactly this shape in `StoreVersion.snapshot`
 *    and read it back through the same schema.
 *
 * Templates and sections only ever see this type: never a Prisma row, never a user id, never a
 * database id other than opaque product/category ids. It is validated strictly at the boundary
 * (`storefrontDataSchema`), so persisted JSON is never trusted by type alone.
 */
export const STOREFRONT_SCHEMA_VERSION = 1;

const slug = z.string().refine(isCanonicalSlug, "canonical slug expected");
const id = z.string().min(1).max(64);

/**
 * A published image reference: the RELATIVE object key plus its real dimensions. No host or bucket is ever stored
 * here (nor in the database): the public URL is built at render time by `RenderContext.mediaUrl`.
 * Optional with a null default so data/snapshots written before media existed stay valid under schemaVersion 1.
 */
export const mediaRefSchema = z
  .object({ key: z.string().regex(MEDIA_KEY_RE), width: z.number().int().min(1).max(2048), height: z.number().int().min(1).max(2048) })
  .strict();
export type MediaRef = z.infer<typeof mediaRefSchema>;

export const storefrontStoreSchema = z
  .object({
    name: z.string().min(1).max(80),
    direction: z.enum(["rtl", "ltr"]),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    contact: z.object({ phone: z.string().max(40), email: z.string().max(254), address: z.string().max(300) }).strict(),
    social: z.object({ instagram: z.string().max(64), telegram: z.string().max(64), whatsapp: z.string().max(64) }).strict(),
    logo: mediaRefSchema.nullable().default(null),
    typography: typographySchema.default(DEFAULT_TYPOGRAPHY),
    // Owner-written short description (phase 11). Deliberately OPTIONAL WITHOUT a default and absent when empty: snapshots
    // and drafts of stores that never set one are byte-for-byte what they were before, so no content hash changes.
    description: z.string().max(160).optional(),
  })
  .strict();

export const storefrontPageSchema = z
  .object({
    type: z.enum(PAGE_TYPES),
    title: z.string().min(1).max(80),
    slug: z.string().min(1).max(60),
    position: z.number().int().min(0).max(1000),
    // Any valid section of the global registry (core or theme-specific); validated by its own strict schema.
    sections: z.array(pageSectionSchema).max(30),
  })
  .strict();

export const storefrontCategorySchema = z.object({ id, name: z.string().min(1).max(60), slug }).strict();

export const storefrontProductSchema = z
  .object({
    id,
    name: z.string().min(1).max(120),
    slug,
    description: z.string().max(5000),
    price: z.number().int().min(0).max(MAX_PRICE_TOMAN),
    stockQuantity: z.number().int().min(0).max(1_000_000),
    categoryId: id.nullable(),
    image: mediaRefSchema.nullable().default(null),
    // Product specifications (product data, independent of theme and category). Optional with an empty default, so
    // schemaVersion-1 data and snapshots written before specs existed stay valid.
    specs: z.array(specRowSchema).max(MAX_SPEC_ROWS).default([]),
  })
  .strict();

export const storefrontDataSchema = z
  .object({
    schemaVersion: z.literal(STOREFRONT_SCHEMA_VERSION),
    template: z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), version: z.number().int().min(1) }).strict(),
    store: storefrontStoreSchema,
    pages: z.array(storefrontPageSchema).max(20),
    categories: z.array(storefrontCategorySchema).max(50),
    products: z.array(storefrontProductSchema).max(500),
    /** Images referenced by sections (hero/imageText `imageId`), keyed by media id. Relative keys only. */
    images: z.record(id, mediaRefSchema).default({}),
  })
  .strict()
  .superRefine((d, ctx) => {
    const categoryIds = new Set(d.categories.map((c) => c.id));
    d.products.forEach((p, i) => {
      if (p.categoryId !== null && !categoryIds.has(p.categoryId)) {
        ctx.addIssue({ code: "custom", path: ["products", i, "categoryId"], message: "unknown category" });
      }
    });
    if (Object.keys(d.images).length > 60) ctx.addIssue({ code: "custom", path: ["images"], message: "too many images" });
    const dup = (xs: string[]) => new Set(xs).size !== xs.length;
    if (dup(d.pages.map((p) => p.type))) ctx.addIssue({ code: "custom", path: ["pages"], message: "duplicate page type" });
    if (dup(d.products.map((p) => p.slug))) ctx.addIssue({ code: "custom", path: ["products"], message: "duplicate product slug" });
    if (dup(d.categories.map((c) => c.slug))) ctx.addIssue({ code: "custom", path: ["categories"], message: "duplicate category slug" });
  });

export type StorefrontData = z.infer<typeof storefrontDataSchema>;
export type { PageSection };
export type StorefrontStore = z.infer<typeof storefrontStoreSchema>;
export type StorefrontPage = z.infer<typeof storefrontPageSchema>;
export type StorefrontCategory = z.infer<typeof storefrontCategorySchema>;
export type StorefrontProduct = z.infer<typeof storefrontProductSchema>;

