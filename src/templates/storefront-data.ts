import { z } from "zod";
import { MAX_PRICE_TOMAN } from "@/lib/money";
import { isCanonicalSlug } from "@/lib/text";
import { PAGE_TYPES, SECTION_TYPES, sectionPropsSchemas, type Section, type SectionType } from "./sections";

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

export const storefrontStoreSchema = z
  .object({
    name: z.string().min(1).max(80),
    direction: z.enum(["rtl", "ltr"]),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    contact: z.object({ phone: z.string().max(40), email: z.string().max(254), address: z.string().max(300) }).strict(),
    social: z.object({ instagram: z.string().max(64), telegram: z.string().max(64), whatsapp: z.string().max(64) }).strict(),
  })
  .strict();

const sectionSchemas = SECTION_TYPES.map((type) =>
  z.object({ id: z.string().min(1).max(40), type: z.literal(type), props: sectionPropsSchemas[type] }).strict(),
) as unknown as [z.ZodType<Section>, ...z.ZodType<Section>[]];

export const storefrontPageSchema = z
  .object({
    type: z.enum(PAGE_TYPES),
    title: z.string().min(1).max(80),
    slug: z.string().min(1).max(60),
    position: z.number().int().min(0).max(1000),
    sections: z.array(z.union(sectionSchemas)).max(30),
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
  })
  .strict()
  .superRefine((d, ctx) => {
    const categoryIds = new Set(d.categories.map((c) => c.id));
    d.products.forEach((p, i) => {
      if (p.categoryId !== null && !categoryIds.has(p.categoryId)) {
        ctx.addIssue({ code: "custom", path: ["products", i, "categoryId"], message: "unknown category" });
      }
    });
    const dup = (xs: string[]) => new Set(xs).size !== xs.length;
    if (dup(d.pages.map((p) => p.type))) ctx.addIssue({ code: "custom", path: ["pages"], message: "duplicate page type" });
    if (dup(d.products.map((p) => p.slug))) ctx.addIssue({ code: "custom", path: ["products"], message: "duplicate product slug" });
    if (dup(d.categories.map((c) => c.slug))) ctx.addIssue({ code: "custom", path: ["categories"], message: "duplicate category slug" });
  });

export type StorefrontData = z.infer<typeof storefrontDataSchema>;
export type StorefrontStore = z.infer<typeof storefrontStoreSchema>;
export type StorefrontPage = z.infer<typeof storefrontPageSchema>;
export type StorefrontCategory = z.infer<typeof storefrontCategorySchema>;
export type StorefrontProduct = z.infer<typeof storefrontProductSchema>;

export type SectionOfType<T extends SectionType> = Extract<Section, { type: T }>;
