import { MEDIA_KEY_RE, isValidMediaKey } from "./keys.js";

/**
 * Smaller copies of an uploaded image (derived objects). The main object `stores/<store>/<token>.webp` stays what the database row and the
 * published data point at; a copy has the same key with `-w<width>` before the extension. Copies are never referenced by a row of their own: they
 * live and die with their main object, and a media row says whether they exist (`variantsReady`).
 */
export const VARIANT_WIDTHS = [320, 640, 1024] as const;
export type VariantWidth = (typeof VARIANT_WIDTHS)[number];
export const MEDIA_VARIANT_KEY_RE = /^stores\/[A-Za-z0-9]{1,64}\/[0-9a-f]{32}-w(?:320|640|1024)\.webp$/;

export const isVariantMediaKey = (key: unknown): key is string => typeof key === "string" && MEDIA_VARIANT_KEY_RE.test(key);
/** A key an object may be stored or served under: a main key or a copy's key. */
export const isStorableMediaKey = (key: unknown): key is string => isValidMediaKey(key) || isVariantMediaKey(key);

export const variantKey = (mainKey: string, width: VariantWidth): string => mainKey.replace(/\.webp$/, `-w${width}.webp`);
/** The main key a copy belongs to (a main key is its own); null for anything else. */
export function mainKeyOf(key: string): string | null {
  if (MEDIA_KEY_RE.test(key)) return key;
  return MEDIA_VARIANT_KEY_RE.test(key) ? key.replace(/-w(?:320|640|1024)\.webp$/, ".webp") : null;
}
export const variantKeysOf = (mainKey: string): string[] => VARIANT_WIDTHS.map((w) => variantKey(mainKey, w));

/** The copies made for an image `width` pixels wide: only those smaller than the image itself (a picture is never enlarged). */
export const variantWidthsFor = (width: number): VariantWidth[] => VARIANT_WIDTHS.filter((w) => w < width);

/**
 * The `srcset` of an image whose copies exist: its copies, plus the image itself when it is not wider than the largest copy. Null when there is
 * nothing to choose from (no copies, or an image that is already small). `urlOf` builds a public address from a key (null = cannot).
 */
export function srcSetFor(ref: { key: string; width: number; variants?: boolean }, urlOf: (key: string) => string | null): string | null {
  if (!ref.variants) return null;
  const widths = variantWidthsFor(ref.width);
  if (widths.length === 0) return null;
  const parts: string[] = [];
  for (const w of widths) {
    const url = urlOf(variantKey(ref.key, w));
    if (!url) return null;
    parts.push(`${url} ${w}w`);
  }
  if (ref.width <= VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]!) {
    const url = urlOf(ref.key);
    if (!url) return null;
    parts.push(`${url} ${ref.width}w`);
  }
  return parts.join(", ");
}

/** What the browser is told about the space the image will fill: a small card, or a large (detail / banner) image. */
export const IMAGE_SIZES = { card: "(max-width: 600px) 50vw, 320px", large: "(max-width: 768px) 100vw, 1024px" } as const;
