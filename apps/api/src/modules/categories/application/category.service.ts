import { z } from "zod";
import { createCategorySchema, deleteCategoryOptionsSchema, updateCategorySchema } from "@store-builder/shared/modules/categories/schemas";
import { CategoryNotEmptyError, NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { storeIdSchema } from "@store-builder/shared/modules/stores/schemas";
import { assertBelowLimit, assertUniqueName, duplicateKeyError, newSlug } from "../domain/category.js";
import { DuplicateKeyError, StillReferencedError, type CategoryReader, type CategoryUnitOfWork, type CategoryView, type StoreOwnership } from "./ports.js";

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.flatten().fieldErrors as Record<string, string[]>);
  return r.data;
}

/** A malformed id is reported exactly like an unknown one (no hint that the format was the problem). */
function parseIdOrNotFound(id: unknown): string {
  const r = storeIdSchema.safeParse(id);
  if (!r.success) throw new NotFoundError();
  return r.data;
}

function translateDuplicate(e: unknown): unknown {
  return e instanceof DuplicateKeyError ? duplicateKeyError(e.field) : e;
}

/**
 * Category use cases of the merchant dashboard. `ownerId` always comes from the server session, never from request data; every
 * other argument is untrusted input and validated here.
 */
export class CategoryService {
  constructor(
    private readonly reader: CategoryReader,
    private readonly unitOfWork: CategoryUnitOfWork,
    private readonly stores: StoreOwnership,
  ) {}

  async list(ownerId: string, storeId: unknown): Promise<CategoryView[]> {
    const sid = parseIdOrNotFound(storeId);
    await this.stores.assertOwned(ownerId, sid); // 404 for a missing or foreign store, even though the query is owner-scoped too
    return this.reader.list(ownerId, sid);
  }

  async create(ownerId: string, storeId: unknown, input: unknown): Promise<{ id: string }> {
    const sid = parseIdOrNotFound(storeId);
    const { name } = parseOrThrow(createCategorySchema, input);
    try {
      return await this.unitOfWork.run(ownerId, sid, async (writes) => {
        assertBelowLimit(await writes.count());
        const existing = await writes.list();
        assertUniqueName(existing, name);
        return writes.insert({ name, slug: newSlug(name, existing) });
      });
    } catch (e) {
      throw translateDuplicate(e);
    }
  }

  async update(ownerId: string, storeId: unknown, categoryId: unknown, input: unknown): Promise<void> {
    const sid = parseIdOrNotFound(storeId);
    const id = parseIdOrNotFound(categoryId);
    const { name } = parseOrThrow(updateCategorySchema, input);
    const current = await this.reader.find(ownerId, sid, id);
    if (!current) throw new NotFoundError();
    if (current.name === name) return; // nothing changed: no write, no draftRevision bump
    try {
      await this.unitOfWork.run(ownerId, sid, async (writes) => {
        const existing = await writes.list();
        if (!existing.some((c) => c.id === id)) throw new NotFoundError();
        assertUniqueName(existing, name, id);
        if (!(await writes.rename(id, name))) throw new NotFoundError();
      });
    } catch (e) {
      throw translateDuplicate(e);
    }
  }

  /**
   * Default: refuses to delete a category that still has products (CategoryNotEmptyError carries the count). With
   * `moveProducts: true` the products become uncategorised and the category is deleted in the same transaction. The store row lock
   * serialises this against product writes; the foreign key (Restrict) stays the final backstop (count -1: attached concurrently).
   */
  async delete(ownerId: string, storeId: unknown, categoryId: unknown, options: unknown = { moveProducts: false }): Promise<{ movedProducts: number }> {
    const sid = parseIdOrNotFound(storeId);
    const id = parseIdOrNotFound(categoryId);
    const { moveProducts } = parseOrThrow(deleteCategoryOptionsSchema, options);
    try {
      return await this.unitOfWork.run(ownerId, sid, async (writes) => {
        if (!(await writes.find(id)) || !(await writes.lock(id))) throw new NotFoundError();
        const productCount = await writes.countProducts(id);
        if (productCount > 0 && !moveProducts) throw new CategoryNotEmptyError(productCount);
        const movedProducts = productCount > 0 ? await writes.detachProducts(id) : 0;
        if (!(await writes.delete(id))) throw new NotFoundError();
        return { movedProducts };
      });
    } catch (e) {
      if (e instanceof StillReferencedError) throw new CategoryNotEmptyError(-1);
      throw e;
    }
  }
}
