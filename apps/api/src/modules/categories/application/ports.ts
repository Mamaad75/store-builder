import type { CategoryRef } from "../domain/category.js";

/** What the dashboard lists: the rule fields plus the creation time and the number of products in the category. */
export interface CategoryView extends CategoryRef {
  createdAt: Date;
  _count: { products: number };
}

/** Reads outside a mutation. Every query is bound to `ownerId` in SQL, so a foreign store or category simply is not found. */
export interface CategoryReader {
  list(ownerId: string, storeId: string): Promise<CategoryView[]>;
  find(ownerId: string, storeId: string, id: string): Promise<CategoryView | null>;
}

/** Category operations inside one store mutation (see CategoryUnitOfWork). The boolean results are "exactly one row affected". */
export interface CategoryWrites {
  count(): Promise<number>;
  list(): Promise<CategoryRef[]>;
  find(id: string): Promise<CategoryRef | null>;
  insert(data: { name: string; slug: string }): Promise<{ id: string }>;
  rename(id: string, name: string): Promise<boolean>;
  /** Row lock on the category (the store row is already locked: order Store -> category -> product). */
  lock(id: string): Promise<boolean>;
  countProducts(categoryId: string): Promise<number>;
  /** Makes the category's products uncategorised; returns how many. */
  detachProducts(categoryId: string): Promise<number>;
  delete(id: string): Promise<boolean>;
}

/**
 * One transaction per call: ownership is verified in SQL (missing or foreign store => NotFoundError), the store row is locked and
 * its draftRevision bumped, and everything rolls back if `work` throws (so a failed change never bumps the revision). A store that
 * stays locked longer than the draft lock timeout fails with DraftBusyError. Constraint violations come out as the errors below.
 */
export interface CategoryUnitOfWork {
  run<T>(ownerId: string, storeId: string, work: (writes: CategoryWrites) => Promise<T>): Promise<T>;
}

/** Ownership check for operations that do not open a mutation. */
export interface StoreOwnership {
  /** Throws NotFoundError for a missing store and for a store of another owner alike. */
  assertOwned(ownerId: string, storeId: string): Promise<void>;
}

/** The database refused a write because of a unique constraint (`field` when the adapter can tell which). */
export class DuplicateKeyError extends Error {
  constructor(readonly field: "name" | "slug" | null) {
    super(`duplicate key${field ? `: ${field}` : ""}`);
    this.name = "DuplicateKeyError";
  }
}

/** The database refused a delete because rows still reference the category (a product attached concurrently). */
export class StillReferencedError extends Error {
  constructor() {
    super("row is still referenced");
    this.name = "StillReferencedError";
  }
}
