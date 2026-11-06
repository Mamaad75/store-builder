import { z } from "zod";
import { makeSearchKey, slugify, uniqueSlug } from "@/lib/text";
import { mapCatalogDbError } from "@/modules/catalog-errors";
import { CatalogLimitError, CategoryNotEmptyError, NotFoundError, ValidationError } from "@/modules/stores/errors";
import { withStoreMutation } from "@/modules/stores/mutation";
import { getStore, parseStoreId } from "@/modules/stores/service";
import {
  CategoryRepository,
  countInTx,
  countProductsInCategory,
  deleteCategoryRow,
  detachProductsFromCategory,
  findInTx,
  insertCategory,
  listInTx,
  lockCategory,
  renameCategory,
  type CategoryView,
} from "./repository";
import {
  MAX_CATEGORIES_PER_STORE,
  createCategorySchema,
  deleteCategoryOptionsSchema,
  updateCategorySchema,
} from "./schemas";

/** `ownerId` always comes from the server session (requireUser()), never from request data. */

const DUPLICATE_NAME = "دسته‌ای با این نام قبلاً ثبت شده است";

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

export async function listCategories(ownerId: string, storeId: unknown): Promise<CategoryView[]> {
  const sid = parseStoreId(storeId);
  await getStore(ownerId, sid); // 404 for a missing or foreign store, even though the query is owner-scoped too
  return new CategoryRepository(ownerId).list(sid);
}

export async function createCategory(ownerId: string, storeId: unknown, input: unknown): Promise<{ id: string }> {
  const sid = parseStoreId(storeId);
  const { name } = parseOrThrow(createCategorySchema, input);
  try {
    return await withStoreMutation(ownerId, sid, async (ctx) => {
      if ((await countInTx(ctx)) >= MAX_CATEGORIES_PER_STORE) {
        throw new CatalogLimitError("category", MAX_CATEGORIES_PER_STORE);
      }
      const existing = await listInTx(ctx);
      const key = makeSearchKey(name);
      if (existing.some((c) => makeSearchKey(c.name) === key)) throw new ValidationError({ name: [DUPLICATE_NAME] });
      const slug = uniqueSlug(slugify(name, "category"), new Set(existing.map((c) => c.slug)));
      return insertCategory(ctx, { name, slug });
    });
  } catch (e) {
    throw mapCatalogDbError(e, { unique: { name: DUPLICATE_NAME, slug: DUPLICATE_NAME } });
  }
}

export async function updateCategory(ownerId: string, storeId: unknown, categoryId: unknown, input: unknown) {
  const sid = parseStoreId(storeId);
  const id = parseId(categoryId);
  const { name } = parseOrThrow(updateCategorySchema, input);
  const current = await new CategoryRepository(ownerId).find(sid, id);
  if (!current) throw new NotFoundError();
  if (current.name === name) return; // nothing changed: no write, no draftRevision bump
  try {
    await withStoreMutation(ownerId, sid, async (ctx) => {
      const existing = await listInTx(ctx);
      if (!existing.some((c) => c.id === id)) throw new NotFoundError();
      const key = makeSearchKey(name);
      if (existing.some((c) => c.id !== id && makeSearchKey(c.name) === key)) {
        throw new ValidationError({ name: [DUPLICATE_NAME] });
      }
      if (!(await renameCategory(ctx, id, name))) throw new NotFoundError();
    });
  } catch (e) {
    throw mapCatalogDbError(e, { unique: { name: DUPLICATE_NAME } });
  }
}

/**
 * Default: refuses to delete a category that still has products (CategoryNotEmptyError carries the count).
 * With `moveProducts: true` the products become uncategorised and the category is deleted in one
 * transaction. The store row lock serialises this against product creation/edits; the composite
 * foreign key (Restrict) remains the final backstop.
 */
export async function deleteCategory(
  ownerId: string,
  storeId: unknown,
  categoryId: unknown,
  options: unknown = { moveProducts: false },
): Promise<{ movedProducts: number }> {
  const sid = parseStoreId(storeId);
  const id = parseId(categoryId);
  const { moveProducts } = parseOrThrow(deleteCategoryOptionsSchema, options);
  try {
    return await withStoreMutation(ownerId, sid, async (ctx) => {
      if (!(await findInTx(ctx, id)) || !(await lockCategory(ctx, id))) throw new NotFoundError();
      const productCount = await countProductsInCategory(ctx, id);
      if (productCount > 0 && !moveProducts) throw new CategoryNotEmptyError(productCount);
      const movedProducts = productCount > 0 ? await detachProductsFromCategory(ctx, id) : 0;
      if (!(await deleteCategoryRow(ctx, id))) throw new NotFoundError();
      return { movedProducts };
    });
  } catch (e) {
    // The FK refused the delete: a product was attached concurrently (only possible outside the store lock).
    const mapped = mapCatalogDbError(e);
    if (mapped instanceof ValidationError) throw new CategoryNotEmptyError(-1);
    throw e;
  }
}
