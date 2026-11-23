import { z } from "zod";
import { MAX_PRICE_TOMAN } from "../../lib/money.js";
import { normalizeFa } from "../../lib/text.js";

/**
 * Product variants (phase 3.2, D32-1). A product either has no variants (its own price and stock) or 1..30 variants that all use the SAME
 * option names in the same order (e.g. ["رنگ", "سایز"]), each combination once. The product then shows the lowest variant price and the
 * summed stock. Pure: shared by the API (validation) and the storefront.
 */
export const MAX_OPTIONS = 3;
export const MAX_VARIANTS_PER_PRODUCT = 30;
export const MAX_VARIANTS_PER_STORE = 3000;
/** The product's stock is the sum of its variants and has the same upper bound as any stock (DB CHECK on Product). */
export const MAX_STOCK = 1_000_000;

const text = (max: number, label: string) =>
  z
    .string()
    .transform((v) => normalizeFa(v))
    .pipe(
      z
        .string()
        .min(1, `${label} را وارد کنید`)
        .max(max, `${label} حداکثر ${max} نویسه است`)
        // Control characters and lone surrogates: never meaningful, and JSON would escape each to 6 characters in optionsKey.
        .regex(/^[^\p{Cc}\p{Cs}]*$/u, `${label} نویسه‌ی نامعتبر دارد`),
    );

export const variantOptionSchema = z.object({ name: text(30, "نام ویژگی"), value: text(40, "مقدار ویژگی") }).strict();
export type VariantOption = z.output<typeof variantOptionSchema>;

export const variantInputSchema = z
  .object({
    options: z.array(variantOptionSchema).min(1).max(MAX_OPTIONS),
    price: z.number().int().min(0).max(MAX_PRICE_TOMAN),
    stockQuantity: z.number().int().min(0).max(MAX_STOCK),
    sku: z
      .string()
      .trim()
      .max(64)
      .regex(/^[A-Za-z0-9._-]*$/, "کد انبار فقط حروف انگلیسی، عدد و . _ -")
      .optional(),
  })
  .strict();
export type VariantInput = z.output<typeof variantInputSchema>;

/** The whole variant set of a product (replace semantics: [] = the product has no variants any more). */
export const replaceVariantsSchema = z.object({ variants: z.array(variantInputSchema).max(MAX_VARIANTS_PER_PRODUCT) }).strict();

/**
 * Canonical key of a combination (`[["رنگ","قرمز"],["سایز","M"]]`): one variant per combination. JSON, so no name or value can make two
 * different combinations collide (a plain "name=value|…" join could).
 */
export const optionsKeyOf = (options: readonly VariantOption[]): string => JSON.stringify(options.map((o) => [o.name, o.value]));

export type VariantSetProblem = "names_differ" | "duplicate_combination" | "duplicate_option_name" | "duplicate_sku" | "stock_total";

/** Set-level rules a per-variant schema cannot express. Null = valid. */
export function variantSetProblem(variants: readonly VariantInput[]): VariantSetProblem | null {
  if (variants.length === 0) return null;
  const names = variants[0]!.options.map((o) => o.name);
  if (new Set(names).size !== names.length) return "duplicate_option_name";
  for (const v of variants) if (v.options.length !== names.length || v.options.some((o, i) => o.name !== names[i])) return "names_differ";
  if (new Set(variants.map((v) => optionsKeyOf(v.options))).size !== variants.length) return "duplicate_combination";
  const skus = variants.map((v) => v.sku).filter((s): s is string => Boolean(s));
  if (new Set(skus).size !== skus.length) return "duplicate_sku";
  if (variants.reduce((sum, v) => sum + v.stockQuantity, 0) > MAX_STOCK) return "stock_total";
  return null;
}

export const VARIANT_SET_MESSAGES: Record<VariantSetProblem, string> = {
  names_differ: "همه‌ی تنوع‌ها باید ویژگی‌های یکسان و به همان ترتیب داشته باشند.",
  duplicate_combination: "هر ترکیب ویژگی‌ها فقط یک بار می‌تواند بیاید.",
  duplicate_option_name: "نام هر ویژگی فقط یک بار می‌تواند بیاید.",
  duplicate_sku: "کد انبار تکراری است.",
  stock_total: "مجموع موجودی تنوع‌های یک محصول حداکثر ۱٬۰۰۰٬۰۰۰ است.",
};

/** What a product shows when it has variants: the lowest price and the summed stock. */
export function variantSummary(variants: readonly { price: number; stockQuantity: number }[]): { price: number; stockQuantity: number } | null {
  if (variants.length === 0) return null;
  return { price: Math.min(...variants.map((v) => v.price)), stockQuantity: variants.reduce((s, v) => s + v.stockQuantity, 0) };
}
