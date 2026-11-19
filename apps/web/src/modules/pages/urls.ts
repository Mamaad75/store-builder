import type { PageType } from "@/templates/sections";

export const pagesUrl = (storeId: string) => `/dashboard/stores/${encodeURIComponent(storeId)}/pages`;
export const appearanceUrl = (storeId: string) => `/dashboard/stores/${encodeURIComponent(storeId)}/appearance`;
/** `PRODUCT_DETAIL` <-> `product-detail` */
export const pageSlug = (type: PageType | string) => type.toLowerCase().replace(/_/g, "-");
export const pageTypeFromSlug = (slug: string) => slug.toUpperCase().replace(/-/g, "_");
export const pageUrl = (storeId: string, type: PageType | string) => `${pagesUrl(storeId)}/${pageSlug(type)}`;
