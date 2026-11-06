import { z } from "zod";
import { MAX_PRICE_TOMAN, parseIntegerInput } from "@/lib/money";
import { SLUG_MAX, normalizeFa, normalizeFaText, slugify } from "@/lib/text";
import { PRODUCT_STATUSES } from "./status";

export const MAX_PRODUCTS_PER_STORE = 500;
export const MAX_STOCK_QUANTITY = 1_000_000;
export const PRODUCT_PAGE_SIZE_DEFAULT = 20;
export const PRODUCT_PAGE_SIZE_MAX = 50;

const intField = (min: number, max: number, message: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? parseIntegerInput(v) : v),
    z.number({ error: message }).int(message).min(min, message).max(max, message),
  );

const name = z
  .string({ error: "نام محصول را وارد کنید" })
  .transform(normalizeFa)
  .pipe(z.string().min(1, "نام محصول را وارد کنید").max(120, "نام محصول حداکثر ۱۲۰ کاراکتر است"));

const description = z
  .string({ error: "توضیحات نامعتبر است" })
  .transform(normalizeFaText)
  .pipe(z.string().max(5000, "توضیحات حداکثر ۵۰۰۰ کاراکتر است"));

const price = intField(0, MAX_PRICE_TOMAN, "قیمت باید عدد صحیح بین ۰ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان باشد");
const stockQuantity = intField(0, MAX_STOCK_QUANTITY, "موجودی باید عدد صحیح بین ۰ تا ۱٬۰۰۰٬۰۰۰ باشد");

/** Blank => no value (auto-generate / keep current). Otherwise sanitised to the canonical slug. */
const slug = z
  .string({ error: "آدرس محصول نامعتبر است" })
  .transform((s) => s.trim())
  .pipe(z.string().max(200, "آدرس محصول بیش از حد طولانی است"))
  .transform((s) => (s === "" ? undefined : slugify(s, "")))
  .refine((s) => s === undefined || (s.length >= 1 && s.length <= SLUG_MAX), {
    message: "آدرس محصول باید شامل حروف یا عدد باشد و حداکثر ۸۰ کاراکتر باشد",
  });

const categoryId = z
  .union([z.string().max(64), z.null()])
  .transform((v) => (v === null || v === "" ? null : v));

export const createProductSchema = z
  .object({
    name,
    description: description.optional().default(""),
    price,
    stockQuantity: stockQuantity.optional().default(0),
    categoryId: categoryId.optional().default(null),
    slug: slug.optional(),
  })
  .strict();

/** Whitelist of editable fields. `status` is intentionally absent: it changes only via changeProductStatus. */
export const updateProductSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    price: price.optional(),
    stockQuantity: stockQuantity.optional(),
    categoryId: categoryId.optional(),
    slug: slug.optional(),
    confirmSlugChange: z.boolean().optional(),
  })
  .strict();

export const statusSchema = z.enum(PRODUCT_STATUSES, { error: "وضعیت نامعتبر است" });

/** Re-validated when a product is activated (guards against rows that predate current rules). */
export const activationSchema = z.object({
  name: z.string().min(1, "نام محصول را وارد کنید"),
  slug: z.string().min(1, "آدرس محصول را وارد کنید"),
  price: z.number().int().min(0).max(MAX_PRICE_TOMAN, "قیمت نامعتبر است"),
});

export const productListParamsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(64).optional(), // category id or "none"
  status: z.enum(PRODUCT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(PRODUCT_PAGE_SIZE_MAX).optional(),
});

export interface ProductListParams {
  q?: string;
  category?: string;
  status?: (typeof PRODUCT_STATUSES)[number];
  page: number;
  pageSize: number;
}

/** Lenient: each invalid or missing parameter falls back to its default instead of failing the page. */
export function parseProductListParams(raw: Record<string, string | string[] | undefined>): ProductListParams {
  const first = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : raw[k]);
  const out: ProductListParams = { page: 1, pageSize: PRODUCT_PAGE_SIZE_DEFAULT };
  const shape = productListParamsSchema.shape;
  const q = shape.q.safeParse(first("q"));
  if (q.success && q.data) out.q = q.data;
  const category = shape.category.safeParse(first("category"));
  if (category.success && category.data) out.category = category.data;
  const status = shape.status.safeParse(first("status"));
  if (status.success && status.data) out.status = status.data;
  const page = shape.page.safeParse(first("page"));
  if (page.success && page.data) out.page = page.data;
  const pageSize = shape.pageSize.safeParse(first("pageSize"));
  if (pageSize.success && pageSize.data) out.pageSize = pageSize.data;
  return out;
}

export type CreateProductInput = z.output<typeof createProductSchema>;
export type UpdateProductInput = z.output<typeof updateProductSchema>;
