import { isValidMediaKey } from "@store-builder/shared/lib/storage/keys";
import { StorageConfigError, type StorageConfig } from "./config.js";
import { S3MediaStorage } from "./s3.js";
import type { MediaStorage } from "./types.js";

export type { MediaStorage, ListPage, StoredObject } from "./types.js";
export { newMediaKey, isValidMediaKey, storeIdOfKey, MEDIA_KEY_PREFIX } from "@store-builder/shared/lib/storage/keys";

let configured: StorageConfig | undefined;
let instance: MediaStorage | undefined;

/** Called once at start-up (the API's `createApp`, and the jobs' bootstrap) with the validated configuration. */
export function configureStorage(config: StorageConfig | undefined): void {
  configured = config;
  instance = undefined;
}

/** Lazily created from the configuration given to `configureStorage`; throws StorageConfigError when there is none. */
export function getMediaStorage(): MediaStorage {
  if (instance) return instance; // a configured storage, or a test double
  if (!configured) throw new StorageConfigError("Invalid or missing storage configuration: S3_*");
  instance = new S3MediaStorage(configured);
  return instance;
}

/** Test seam: inject a fake storage (undefined restores the configured one). */
export function setMediaStorageForTests(storage: MediaStorage | undefined): void {
  instance = storage;
}

/**
 * The single place that turns an object key into a public URL: `<S3_PUBLIC_BASE_URL>/<key>`. The database and published snapshots store
 * only the relative key, never a host, so the base URL (CDN, bucket domain, ...) can change without touching stored data. (The web app
 * builds the same URL for rendering from its own copy of the public base URL: see apps/web/src/lib/media-url.ts.)
 *
 * SECURITY NOTE: anyone who has an object's URL can read that image; there is no access control on reads.
 */
export function mediaPublicUrl(key: string): string | null {
  if (!isValidMediaKey(key)) return null;
  if (!configured) throw new StorageConfigError("Invalid or missing storage configuration: S3_PUBLIC_BASE_URL");
  return `${configured.publicBaseUrl}/${key}`;
}
