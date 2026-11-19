import { getPublicBaseUrl, getStorageConfig } from "./config";
import { isValidMediaKey } from "./keys";
import { S3MediaStorage } from "./s3";
import type { MediaStorage } from "./types";

export type { MediaStorage, ListPage, StoredObject } from "./types";
export { newMediaKey, isValidMediaKey, storeIdOfKey, MEDIA_KEY_PREFIX } from "./keys";

let instance: MediaStorage | undefined;

/** Lazily created from validated server-side configuration; throws StorageConfigError when it is missing. */
export function getMediaStorage(): MediaStorage {
  instance ??= new S3MediaStorage(getStorageConfig());
  return instance;
}

/** Test seam: inject a fake storage (undefined restores the configured one). */
export function setMediaStorageForTests(storage: MediaStorage | undefined): void {
  instance = storage;
}

/**
 * The single place that turns an object key into a public URL: `<S3_PUBLIC_BASE_URL>/<key>`.
 * The database and published snapshots store only the relative key, never a host, so the base URL
 * (CDN, bucket domain, ...) can change without touching stored data. Invalid keys yield null.
 *
 * SECURITY NOTE: anyone who has an object's URL can read it; there is no access control on reads.
 * Never store private or confidential files with this mechanism.
 */
export function mediaPublicUrl(key: string): string | null {
  if (!isValidMediaKey(key)) return null;
  return `${getPublicBaseUrl()}/${key}`;
}
