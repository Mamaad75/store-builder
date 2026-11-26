/**
 * A product's image gallery: the FIRST image is the product's own image (what cards, search results and link previews use); up to five
 * more can follow it. Pure: shared by the API (limits) and the dashboard and storefront (what to show).
 */
export const MAX_PRODUCT_IMAGES = 6;
export const MAX_GALLERY_EXTRAS = MAX_PRODUCT_IMAGES - 1;
export const GALLERY_FULL_MESSAGE = `هر محصول حداکثر ${MAX_PRODUCT_IMAGES.toLocaleString("fa-IR")} تصویر دارد؛ اول یکی از تصویرها را حذف کنید.`;

/** The lowest free position (1 to 5) among the taken ones, or null when the gallery is full. */
export function nextGalleryPosition(taken: readonly number[]): number | null {
  for (let p = 1; p <= MAX_GALLERY_EXTRAS; p++) if (!taken.includes(p)) return p;
  return null;
}
