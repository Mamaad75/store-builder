import { randomBytes } from "node:crypto";
import { STARTER_ASSETS } from "./starter-assets.js";

// Reserve 120 bits of the object keyspace for bundled, immutable starter images.
const STARTER_PREFIX = "fa383a4136f844a891ffc312aaab0c";

export const MEDIA_KEY_PREFIX = "stores/";
export const MEDIA_KEY_RE = /^stores\/[A-Za-z0-9]{1,64}\/[0-9a-f]{32}\.webp$/;

/**
 * Uploaded object keys use `stores/<storeId>/<128 random bits>.webp`.
 * The random part comes from the OS CSPRNG, so a key cannot be guessed from a media id, a product or a
 * timestamp. Nothing user-controlled (file name, MIME type, client id) ever becomes part of a key.
 */
export function newMediaKey(storeId: string): string {
  if (!/^[A-Za-z0-9]{1,64}$/.test(storeId)) throw new Error("invalid store id for media key");
  let token: string;
  do { token = randomBytes(16).toString("hex"); } while (token.startsWith(STARTER_PREFIX));
  return `${MEDIA_KEY_PREFIX}${storeId}/${token}.webp`;
}

export const isValidMediaKey = (key: unknown): key is string => typeof key === "string" && MEDIA_KEY_RE.test(key);

/** Store id embedded in a valid key (used to bind a key to its owner). */
export const storeIdOfKey = (key: string): string | null => (isValidMediaKey(key) ? key.split("/")[1]! : null);

export function starterAssetForKey(key: string) {
  if (!isValidMediaKey(key)) return null;
  const token = key.split("/")[2]!.slice(0, 32);
  if (!token.startsWith(STARTER_PREFIX)) return null;
  const entry = STARTER_ASSETS[Number.parseInt(token.slice(STARTER_PREFIX.length), 16)];
  return entry ? { path: `/theme-demos/${entry[0]}`, sizeBytes: entry[1] } : null;
}

export function starterMediaKey(storeId: string, path: string): string {
  const index = STARTER_ASSETS.findIndex(([file]) => path === `/theme-demos/${file}`);
  if (index < 0 || index > 255) throw new Error("Unknown starter image");
  const key = `stores/${storeId}/${STARTER_PREFIX}${index.toString(16).padStart(2, "0")}.webp`;
  if (!isValidMediaKey(key)) throw new Error("Invalid store id for starter image");
  return key;
}
