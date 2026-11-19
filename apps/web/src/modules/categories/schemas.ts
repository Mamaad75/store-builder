import { z } from "zod";
import { normalizeFa } from "@/lib/text";

export const MAX_CATEGORIES_PER_STORE = 50;

const name = z
  .string({ error: "نام دسته را وارد کنید" })
  .transform(normalizeFa)
  .pipe(z.string().min(1, "نام دسته را وارد کنید").max(60, "نام دسته حداکثر ۶۰ کاراکتر است"));

/** Slugs of categories are generated from the name once and never editable (not used in URLs yet). */
export const createCategorySchema = z.object({ name }).strict();
export const updateCategorySchema = z.object({ name }).strict();
export const deleteCategoryOptionsSchema = z.object({ moveProducts: z.boolean() }).strict();
