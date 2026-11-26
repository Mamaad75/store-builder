import { makeStorefront } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontData } from "@store-builder/shared/templates/storefront-data";

/**
 * The four original themes (general, coffee, fashion, appliances) have no demo in the theme gallery, so render tests build their data from the
 * shared storefront fixture with the theme's key. Images resolve to a fixed path so a test can look for them in the markup.
 */
export const LEGACY_THEMES = ["general", "coffee", "fashion", "appliances"] as const;
export const legacyMediaUrl = (key: string) => `/media/${key}`;
export function legacyData(key: string, over: Partial<StorefrontData> = {}): StorefrontData {
  return makeStorefront({ template: { key, version: 1 }, ...over });
}
