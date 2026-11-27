import { variantKeysOf } from "@store-builder/shared/lib/storage/variants";
import type { MediaStorage } from "../../lib/storage/index.js";

/** Deletes an image's object and its smaller copies (copies first: a failure leaves the main object so the caller retries the whole thing). Idempotent. */
export async function deleteMediaObjects(storage: MediaStorage, key: string): Promise<void> {
  for (const k of variantKeysOf(key)) await storage.delete(k);
  await storage.delete(key);
}
