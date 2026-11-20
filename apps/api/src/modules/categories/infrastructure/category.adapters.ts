import { Prisma } from "../../../database/prisma-runtime.js";
import { getStore, withStoreMutation, type MutationContext } from "../../stores/stores.api.js";
import { CategoryService } from "../application/category.service.js";
import {
  DuplicateKeyError,
  StillReferencedError,
  type CategoryReader,
  type CategoryUnitOfWork,
  type CategoryView,
  type CategoryWrites,
  type StoreOwnership,
} from "../application/ports.js";
import * as rows from "./prisma-category.repository.js";

export class PrismaCategoryReader implements CategoryReader {
  list(ownerId: string, storeId: string): Promise<CategoryView[]> {
    return new rows.CategoryRepository(ownerId).list(storeId);
  }

  find(ownerId: string, storeId: string, id: string): Promise<CategoryView | null> {
    return new rows.CategoryRepository(ownerId).find(storeId, id);
  }
}

function writesFor(ctx: MutationContext): CategoryWrites {
  return {
    count: () => rows.countInTx(ctx),
    list: () => rows.listInTx(ctx),
    find: (id) => rows.findInTx(ctx, id),
    insert: (data) => rows.insertCategory(ctx, data),
    rename: (id, name) => rows.renameCategory(ctx, id, name),
    lock: (id) => rows.lockCategory(ctx, id),
    countProducts: (id) => rows.countProductsInCategory(ctx, id),
    detachProducts: (id) => rows.detachProductsFromCategory(ctx, id),
    delete: (id) => rows.deleteCategoryRow(ctx, id),
  };
}

/** Translates the driver errors a category write can legitimately hit into the port's errors; anything else passes unchanged. */
function translateDbError(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      const target = ([] as string[]).concat((e.meta?.target as string[] | string | undefined) ?? []).join(",");
      return new DuplicateKeyError(target.includes("name") ? "name" : target.includes("slug") ? "slug" : null);
    }
    if (e.code === "P2003") return new StillReferencedError();
  }
  return e;
}

/** The store mutation (withStoreMutation: ownership in SQL, store row lock, draftRevision bump, draft lock timeout) as a unit of work. */
export class PrismaCategoryUnitOfWork implements CategoryUnitOfWork {
  async run<T>(ownerId: string, storeId: string, work: (writes: CategoryWrites) => Promise<T>): Promise<T> {
    try {
      return await withStoreMutation(ownerId, storeId, (ctx) => work(writesFor(ctx)));
    } catch (e) {
      throw translateDbError(e);
    }
  }
}

export class StoresModuleOwnership implements StoreOwnership {
  async assertOwned(ownerId: string, storeId: string): Promise<void> {
    await getStore(ownerId, storeId);
  }
}

/** Composition: the one place where the PostgreSQL implementations are handed to the use cases. */
export function createCategoryService(): CategoryService {
  return new CategoryService(new PrismaCategoryReader(), new PrismaCategoryUnitOfWork(), new StoresModuleOwnership());
}
