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
