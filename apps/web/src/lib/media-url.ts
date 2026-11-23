import { isValidMediaKey, starterAssetForKey } from "@store-builder/shared/lib/storage/keys";

/**
 * The single place in the web app that turns an object key into a public image URL: `<S3_PUBLIC_BASE_URL>/<key>`. The database and
 * published snapshots store only relative keys, so the base URL (CDN, bucket domain) can change without touching stored data.
 * The web app holds no storage credentials: uploading and deleting objects is the API's job. Invalid keys yield null.
 *
 * SECURITY NOTE: anyone who has an object's URL can read it. Never store private files with this mechanism.
 */
export function mediaPublicUrl(key: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!isValidMediaKey(key)) return null;
  const starter = starterAssetForKey(key);
  if (starter) return starter.path;
  const base = (env.S3_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(base)) throw new Error("Invalid or missing storage configuration: S3_PUBLIC_BASE_URL");
  return `${base}/${key}`;
}
