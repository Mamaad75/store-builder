/** Thrown for BOTH "does not exist" and "belongs to someone else", so callers cannot tell them apart. */
export class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

export class StoreLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Store limit reached (${limit})`);
    this.name = "StoreLimitError";
  }
}

export class ValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string[]>) {
    super("Validation failed");
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  constructor() {
    super("The store was modified concurrently");
    this.name = "ConflictError";
  }
}

export type CatalogKind = "product" | "category";

export class CatalogLimitError extends Error {
  constructor(
    public readonly kind: CatalogKind,
    public readonly limit: number,
  ) {
    super(`${kind} limit reached (${limit})`);
    this.name = "CatalogLimitError";
  }
}

/** A category that still contains products cannot be deleted without the explicit "move" confirmation. */
export class CategoryNotEmptyError extends Error {
  constructor(public readonly productCount: number) {
    super("Category is not empty");
    this.name = "CategoryNotEmptyError";
  }
}

/**
 * A draft change could not get the store's lock within the lock timeout (PostgreSQL 55P03), typically because a publish (or
 * another change) is running. RETRYABLE: the transaction was rolled back, nothing was written, and the same request can be
 * repeated. Draft writers never retry on their own.
 */
export class DraftBusyError extends Error {
  readonly retryable = true as const;
  constructor() {
    super("The store is busy; the change was not saved and can be retried");
    this.name = "DraftBusyError";
  }
}

/** The owner-facing message for DraftBusyError (shared by every dashboard action). */
export const DRAFT_BUSY_MESSAGE = "فروشگاه در حال انجام عملیات دیگری است (مثلاً انتشار). تغییر شما ذخیره نشد؛ چند لحظه بعد دوباره تلاش کنید.";
