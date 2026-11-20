import { randomBytes } from "node:crypto";

export const MEDIA_KEY_PREFIX = "stores/";
export const MEDIA_KEY_RE = /^stores\/[A-Za-z0-9]{1,64}\/[0-9a-f]{32}\.webp$/;

/**
 * Object keys are generated here and nowhere else: `stores/<storeId>/<128 random bits>.webp`.
 * The random part comes from the OS CSPRNG, so a key cannot be guessed from a media id, a product or a
 * timestamp. Nothing user-controlled (file name, MIME type, client id) ever becomes part of a key.
 */
export function newMediaKey(storeId: string): string {
  if (!/^[A-Za-z0-9]{1,64}$/.test(storeId)) throw new Error("invalid store id for media key");
  return `${MEDIA_KEY_PREFIX}${storeId}/${randomBytes(16).toString("hex")}.webp`;
}

export const isValidMediaKey = (key: unknown): key is string => typeof key === "string" && MEDIA_KEY_RE.test(key);

/** Store id embedded in a valid key (used to bind a key to its owner). */
export const storeIdOfKey = (key: string): string | null => (isValidMediaKey(key) ? key.split("/")[1]! : null);
