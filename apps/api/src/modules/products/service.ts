import { z } from "zod";
import { publishLimits } from "../publishing/constants.js";
import { liveSlugOf } from "../publishing/repository.js";
import { specsUnchanged } from "@store-builder/shared/lib/product-specs";
import { makeSearchKey, normalizeSearchQuery, slugify, uniqueSlug } from "@store-builder/shared/lib/text";
import { mapCatalogDbError } from "../catalog-errors.js";
import { findCategoryInTx } from "../categories/categories.api.js";
import { releaseMediaBestEffort } from "../media/service.js";
import { productHasVariantsInTx } from "../inventory/inventory.api.js";
import { productPriceLinkedInTx } from "../pricing/pricing.api.js";
import { CatalogLimitError, ConflictError, NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { withStoreMutation, type MutationContext } from "../stores/mutation.js";
import { getStore, parseStoreId } from "../stores/service.js";
import {
  ProductRepository,
  countInTx,
  deleteProductRow,
  findInTx,
  findProductImageInTx,
  galleryRows,
  insertProduct,
  publishedSlugFacts,
  setStatusRow,
  slugsStartingWith,
  updateProductRow,
  type ProductPatchRow,
  type ProductView,
} from "./repository.js";
import {
  MAX_PRODUCTS_PER_STORE,
  PRODUCT_PAGE_SIZE_DEFAULT,
  PRODUCT_PAGE_SIZE_MAX,
  activationSchema,
  createProductSchema,
  statusSchema,
  updateProductSchema,
  type ProductListParams,
} from "@store-builder/shared/modules/products/schemas";
import { parseProductListParams } from "@store-builder/shared/modules/products/schemas";
import { PlanLimitError } from "@store-builder/shared/modules/billing/errors";
import { storeLimits } from "../billing/billing.api.js";
import { STATUS_LABEL_FA, canTransition, type ProductStatus } from "@store-builder/shared/modules/products/status";

/** `ownerId` always comes from the server session (requireUser()), never from request data. */

export const SLUG_CONFIRM_MESSAGE =
  "این محصول در فروشگاه منتشرشده است. با تغییر آدرس و انتشار بعدی، آدرس قبلی برای همیشه به آدرس جدید هدایت می‌شود (ریدایرکت ۳۰۱). برای ادامه تأیید کنید.";
export const SLUG_RESERVED_MESSAGE = "این آدرس قبلاً برای یک محصول در این فروشگاه منتشر شده و برای همیشه رزرو است؛ آدرس دیگری انتخاب کنید.";
export const slugHistoryLimitMessage = (limit: number) =>
  `این محصول قبلاً با ${(limit + 1).toLocaleString("fa-IR")} آدرس مختلف منتشر شده و بیش از ${limit.toLocaleString("fa-IR")} آدرس قبلی نگه‌داری نمی‌شود. برای تغییر آدرس به یکی از آدرس‌های منتشرشدهٔ قبلی برگردید.`;
const SLUG_TAKEN = "این آدرس قبلاً برای محصول دیگری استفاده شده است";
const INVALID_CATEGORY = "دسته انتخاب‌شده معتبر نیست";
/** Phase 3.2 (D32-1): a product with variants shows the lowest variant price and the summed stock; they are edited per variant. */
/** Phase 3.2b (D32b-1): a product linked to the dollar or gold gets its price from the link. */
export const LINK_OWNED_MESSAGE = "قیمت این محصول به دلار یا طلا متصل است و خودکار به‌روز می‌شود؛ برای تعیین قیمت دستی، اول اتصال را بردارید.";
export const VARIANT_OWNED_MESSAGE = "این محصول تنوع دارد؛ قیمت و موجودی را برای هر تنوع جداگانه تعیین کنید.";

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.flatten().fieldErrors as Record<string, string[]>);
  return r.data;
}

function parseId(id: unknown): string {
  const r = z.string().min(1).max(64).safeParse(id);
  if (!r.success) throw new NotFoundError();
  return r.data;
}

/**
 * Slug rules that protect published URLs (under the store lock):
 *  - a slug that was ever published for ANOTHER product of this store is reserved forever
 *  - a product keeps at most 1 + maxHistoricalSlugsPerProduct published slugs; a new, never-published slug that would exceed
 *    that is refused NOW (before the owner can publish), with a clear message
 * A product may always return to a slug it was published under.
 */
async function assertSlugAvailable(ctx: MutationContext, productId: string | null, slug: string) {
  const facts = await publishedSlugFacts(ctx, productId, slug);
  if (facts.reservedForAnotherProduct) throw new ValidationError({ slug: [SLUG_RESERVED_MESSAGE] });
  const limit = publishLimits().maxHistoricalSlugsPerProduct;
  if (productId && !facts.ownPublished.includes(slug) && facts.ownPublished.length >= limit + 1) {
    throw new ValidationError({ slug: [slugHistoryLimitMessage(limit)] });
  }
}

async function assertCategoryInStore(ctx: MutationContext, categoryId: string) {
  if (!(await findCategoryInTx(ctx, categoryId))) throw new ValidationError({ categoryId: [INVALID_CATEGORY] });
}

const DB_ERRORS = { unique: { slug: SLUG_TAKEN } };

/**
 * Returns the slug under which a product is live on the published storefront, or null if it never was.
 * Nothing can be published before Phase 10, so the default always answers null. The publishing phase
 * supplies the real implementation (slug history / published snapshot) through this same signature.
 */
export type GetPublishedSlug = (ctx: MutationContext, productId: string) => Promise<string | null>;
export const noPublishedSlug: GetPublishedSlug = async () => null;
/** The real implementation: the slug the product has in the LIVE published version (index lookup, no snapshot parsing). */
export const livePublishedSlug: GetPublishedSlug = (ctx, productId) => liveSlugOf(ctx.tx, ctx.storeId, productId);

export async function listProducts(ownerId: string, storeId: unknown, params: Partial<ProductListParams> = {}) {
  const sid = parseStoreId(storeId);
  await getStore(ownerId, sid); // 404 for a missing or foreign store
  const q = params.q ? normalizeSearchQuery(params.q) : undefined;
  return new ProductRepository(ownerId).list(sid, {
    q: q || undefined,
    categoryId: params.category || undefined,
    status: params.status,
    page: Math.max(1, params.page ?? 1),
    pageSize: Math.min(PRODUCT_PAGE_SIZE_MAX, Math.max(1, params.pageSize ?? PRODUCT_PAGE_SIZE_DEFAULT)),
  });
}

/** v1 product page size (phase 2.5): default and maximum of `limit`. */
export const PRODUCT_CURSOR_LIMIT_DEFAULT = 20;
export const PRODUCT_CURSOR_LIMIT_MAX = 100;

/** Opaque keyset cursor: base64url of "<createdAt ISO>|<id>". Never trusted: a malformed one is a validation error. */
export function encodeProductCursor(k: { createdAt: Date; id: string }): string {
  return Buffer.from(`${k.createdAt.toISOString()}|${k.id}`, "utf8").toString("base64url");
}
export function decodeProductCursor(raw: string): { createdAt: Date; id: string } | null {
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const [iso, id, extra] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (extra !== undefined || !id || !/^[a-z0-9]{1,64}$/.test(id) || Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return null;
  return { createdAt, id };
}

/**
 * v1 product list (phase 2.5): the same filters as `listProducts`, keyset pages instead of page numbers. `limit` 1..100 (default 20);
 * `cursor` is the previous page's `nextCursor`.
 */
export async function listProductsAfter(ownerId: string, storeId: unknown, query: Record<string, string | string[] | undefined>) {
  const sid = parseStoreId(storeId);
  await getStore(ownerId, sid);
  const params = parseProductListParams(query);
  const first = (k: string) => (Array.isArray(query[k]) ? query[k]?.[0] : query[k]);
  const rawLimit = first("limit");
  const limit = rawLimit === undefined ? PRODUCT_CURSOR_LIMIT_DEFAULT : /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!(limit >= 1 && limit <= PRODUCT_CURSOR_LIMIT_MAX)) throw new ValidationError({ limit: [`عددی بین ۱ و ${PRODUCT_CURSOR_LIMIT_MAX.toLocaleString("fa-IR")}`] });
  const rawCursor = first("cursor");
  const after = rawCursor ? decodeProductCursor(rawCursor) : null;
  if (rawCursor && !after) throw new ValidationError({ cursor: ["نشانگر صفحه نامعتبر است"] });
  const q = params.q ? normalizeSearchQuery(params.q) : undefined;
  const page = await new ProductRepository(ownerId).listAfter(sid, { q: q || undefined, categoryId: params.category || undefined, status: params.status }, after, limit);
  return { items: page.items, total: page.total, limit, nextCursor: page.last ? encodeProductCursor(page.last) : null };
}

export async function getProduct(ownerId: string, storeId: unknown, productId: unknown): Promise<ProductView> {
  const product = await new ProductRepository(ownerId).find(parseStoreId(storeId), parseId(productId));
  if (!product) throw new NotFoundError();
  return product;
}

/** Always created as DRAFT; activation is an explicit, validated transition. */
export async function createProduct(ownerId: string, storeId: unknown, input: unknown): Promise<ProductView> {
  const sid = parseStoreId(storeId);
  const data = parseOrThrow(createProductSchema, input);
  try {
    return await withStoreMutation(ownerId, sid, async (ctx) => {
      const have = await countInTx(ctx);
      if (have >= MAX_PRODUCTS_PER_STORE) throw new CatalogLimitError("product", MAX_PRODUCTS_PER_STORE);
      const plan = await storeLimits(ctx.tx, sid, new Date()); // the plan's limit (or the free one), read in the same transaction
      if (have >= plan.maxProducts) throw new PlanLimitError("product", plan.maxProducts, plan.free);
      if (data.categoryId) await assertCategoryInStore(ctx, data.categoryId);
      // Generated under the store lock, so concurrent creates get distinct slugs; an explicit slug that
      // is taken is a validation error (the unique constraint is the final arbiter).
      if (data.slug !== undefined) await assertSlugAvailable(ctx, null, data.slug);
      const slug = data.slug ?? uniqueSlug(slugify(data.name, "product"), await slugsStartingWith(ctx, slugify(data.name, "product")));
      return insertProduct(ctx, {
        name: data.name,
        slug,
        description: data.description,
        price: data.price,
        stockQuantity: data.stockQuantity,
        weightGrams: data.weightGrams,
        categoryId: data.categoryId,
        searchKey: makeSearchKey(data.name),
        specs: data.specs,
      });
    });
  } catch (e) {
    throw mapCatalogDbError(e, DB_ERRORS);
  }
}

/**
 * Editing never changes the slug unless a slug is supplied explicitly, so renaming a product does
 * not silently move its URL. Changing the slug of a product that is live on the published storefront
 * (as reported by `deps.getPublishedSlug`) requires `confirmSlugChange: true`. Status cannot be changed here.
 */
export async function updateProduct(
  ownerId: string,
  storeId: unknown,
  productId: unknown,
  input: unknown,
  deps: { getPublishedSlug?: GetPublishedSlug } = {},
): Promise<ProductView> {
  const getPublishedSlug = deps.getPublishedSlug ?? livePublishedSlug;
  const sid = parseStoreId(storeId);
  const pid = parseId(productId);
  const patch = parseOrThrow(updateProductSchema, input);

  const buildChanges = (cur: ProductView): ProductPatchRow => {
    const c: ProductPatchRow = {};
    if (patch.name !== undefined && patch.name !== cur.name) {
      c.name = patch.name;
      c.searchKey = makeSearchKey(patch.name);
    }
    if (patch.description !== undefined && patch.description !== cur.description) c.description = patch.description;
    if (patch.price !== undefined && patch.price !== cur.price) c.price = patch.price;
    if (patch.stockQuantity !== undefined && patch.stockQuantity !== cur.stockQuantity) c.stockQuantity = patch.stockQuantity;
    if (patch.weightGrams !== undefined && patch.weightGrams !== cur.weightGrams) c.weightGrams = patch.weightGrams;
    if (patch.categoryId !== undefined && patch.categoryId !== cur.categoryId) c.categoryId = patch.categoryId;
    if (patch.slug !== undefined && patch.slug !== cur.slug) c.slug = patch.slug;
    // Specs are written ONLY when explicitly supplied and different. Editing any other field never touches them, so
    // invalid stored specs survive an unrelated edit; replacing or clearing them is a deliberate action by the owner.
    if (patch.specs !== undefined && !specsUnchanged(cur.specs, patch.specs)) c.specs = patch.specs;
    return c;
  };

  const current = await new ProductRepository(ownerId).find(sid, pid);
  if (!current) throw new NotFoundError();
  if (Object.keys(buildChanges(current)).length === 0) return current; // no-op: no write, no revision bump

  try {
    return await withStoreMutation(ownerId, sid, async (ctx) => {
      const locked = await findInTx(ctx, pid);
      if (!locked) throw new NotFoundError();
      const changes = buildChanges(locked);
      if (changes.slug !== undefined && patch.confirmSlugChange !== true && (await getPublishedSlug(ctx, pid)) != null) {
        throw new ValidationError({ slug: [SLUG_CONFIRM_MESSAGE] });
      }
      if (changes.slug !== undefined) await assertSlugAvailable(ctx, pid, changes.slug);
      if (changes.categoryId) await assertCategoryInStore(ctx, changes.categoryId);
      if ((changes.price !== undefined || changes.stockQuantity !== undefined) && (await productHasVariantsInTx(ctx, pid))) {
        throw new ValidationError({ [changes.price !== undefined ? "price" : "stockQuantity"]: [VARIANT_OWNED_MESSAGE] });
      }
      if (changes.price !== undefined && (await productPriceLinkedInTx(ctx, pid))) throw new ValidationError({ price: [LINK_OWNED_MESSAGE] });
      if (!(await updateProductRow(ctx, pid, changes))) throw new NotFoundError();
      const updated = await findInTx(ctx, pid);
      if (!updated) throw new NotFoundError();
      return updated;
    });
  } catch (e) {
    throw mapCatalogDbError(e, DB_ERRORS);
  }
}

/** The only way to change status. Rejects invalid transitions; stock never affects the result. */
export async function changeProductStatus(
  ownerId: string,
  storeId: unknown,
  productId: unknown,
  to: unknown,
): Promise<ProductView> {
  const sid = parseStoreId(storeId);
  const pid = parseId(productId);
  const target = parseOrThrow(z.object({ status: statusSchema }), { status: to }).status;

  return withStoreMutation(ownerId, sid, async (ctx) => {
    const current = await findInTx(ctx, pid);
    if (!current) throw new NotFoundError();
    if (current.status === target) {
      throw new ValidationError({ status: [`محصول از قبل در وضعیت «${STATUS_LABEL_FA[target]}» است`] });
    }
    if (!canTransition(current.status as ProductStatus, target)) {
      throw new ValidationError({
        status: [`انتقال از «${STATUS_LABEL_FA[current.status as ProductStatus]}» به «${STATUS_LABEL_FA[target]}» مجاز نیست`],
      });
    }
    if (target === "ACTIVE") {
      const r = activationSchema.safeParse({ name: current.name, slug: current.slug, price: current.price });
      if (!r.success) throw new ValidationError(r.error.flatten().fieldErrors as Record<string, string[]>);
    }
    if (!(await setStatusRow(ctx, pid, current.status as ProductStatus, target))) throw new ConflictError();
    const updated = await findInTx(ctx, pid);
    if (!updated) throw new NotFoundError();
    return updated;
  });
}

export async function deleteProduct(ownerId: string, storeId: unknown, productId: unknown): Promise<void> {
  const sid = parseStoreId(storeId);
  const pid = parseId(productId);
  const { imageId, extras } = await withStoreMutation(ownerId, sid, async (ctx) => {
    const cur = await findProductImageInTx(ctx, pid);
    if (!cur) throw new NotFoundError();
    const extras = (await galleryRows(ctx, pid)).map((g) => g.mediaId); // read before the rows go with the product
    if (!(await deleteProductRow(ctx, pid))) throw new NotFoundError();
    return { imageId: cur.imageId, extras };
  });
  // The product row is gone, so its images are now unreferenced (unless something else still uses them): release them.
  // Never fails the delete; a failure is logged and the media cleanup removes the image later.
  for (const id of [imageId, ...extras]) if (id) await releaseMediaBestEffort(ownerId, sid, id);
}
