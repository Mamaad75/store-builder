import { z } from "zod";
import { TYPOGRAPHY_SIZE_SCALES } from "@/templates/sections";

export const MAX_STORES_PER_USER = 10;

const name = z.string().trim().min(1, "نام فروشگاه را وارد کنید").max(80, "حداکثر ۸۰ کاراکتر");
const handle = z.string().trim().max(64).regex(/^[A-Za-z0-9._+@-]*$/, "فقط حروف انگلیسی، عدد و . _ - + @");

export const storeIdSchema = z.string().min(1).max(64);

export const createStoreSchema = z
  .object({
    name,
    templateKey: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  })
  .strict();

const numeric = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);

/** Closed allow-lists only: no font family, URL or CSS value can be supplied. */
export const typographyPatchSchema = z
  .object({
    sizeScale: z.enum(TYPOGRAPHY_SIZE_SCALES, { error: "اندازهٔ متن نامعتبر است" }).optional(),
    headingWeight: z.preprocess(numeric, z.union([z.literal(600), z.literal(700), z.literal(800)], { error: "ضخامت عنوان نامعتبر است" })).optional(),
    bodyWeight: z.preprocess(numeric, z.union([z.literal(400), z.literal(500)], { error: "ضخامت متن نامعتبر است" })).optional(),
  })
  .strict();

/**
 * Whitelist of user-editable draft fields. `.strict()` makes any extra key (ownerId, status,
 * publishedVersionId, templateVersionId, ...) a validation error instead of being silently applied.
 */
export const updateStoreSchema = z
  .object({
    name: name.optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "رنگ نامعتبر است").optional(),
    contact: z
      .object({
        phone: z.string().trim().regex(/^[0-9+\-\s()]{0,20}$/, "شماره تماس نامعتبر است").optional(),
        email: z.union([z.literal(""), z.string().trim().max(254).pipe(z.email("ایمیل نامعتبر است"))]).optional(),
        address: z.string().trim().max(300).optional(),
      })
      .strict()
      .optional(),
    social: z
      .object({ instagram: handle.optional(), telegram: handle.optional(), whatsapp: handle.optional() })
      .strict()
      .optional(),
    typography: typographyPatchSchema.optional(),
  })
  .strict();

export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
