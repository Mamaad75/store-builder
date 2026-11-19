export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

export interface ListPage {
  objects: StoredObject[];
  /** Opaque token for the next page; undefined when the listing is complete. */
  next?: string;
}

/**
 * The only thing application modules know about object storage. Implementations live in this
 * directory (S3-compatible, and an in-memory one for tests); no application module imports an SDK.
 *
 * Contract: keys are always server-generated (see keys.ts) and are validated by every implementation;
 * `delete` is idempotent (deleting a missing object succeeds).
 */
export interface MediaStorage {
  put(key: string, body: Buffer, opts: { contentType: string }): Promise<void>;
  delete(key: string): Promise<void>;
  /** Lists objects under a prefix (used only by the cleanup job). */
  list(prefix: string, opts?: { limit?: number; after?: string }): Promise<ListPage>;
  /** Existence check (integration tests and diagnostics). */
  exists(key: string): Promise<boolean>;
}
