import type { StorefrontData, StorefrontPage, StorefrontPost, StorefrontProduct } from "./storefront-data.js";

/** Query parameters a storefront page understands (already parsed and bounded by the engine). */
export interface StorefrontQuery {
  /** Category slug filter for the product listing. */
  category?: string;
  /** 1-based page number of the product listing. */
  page: number;
  /** Search text of the product listing (normalised for display, at most SEARCH_MAX characters); absent when empty. */
  q?: string;
  /** Sort order of the product listing; absent = the store's own order. */
  sort?: ProductSort;
}

/** Listing sort orders a visitor may pick (the default, the store's own order, has no key). */
export const PRODUCT_SORTS = ["cheap", "expensive", "available"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/**
 * Everything a template/section may use while rendering one page. It is built by the engine from
 * validated data; templates never reach for databases, sessions or request objects.
 */
export interface RenderContext {
  data: StorefrontData;
  page: StorefrontPage;
  query: StorefrontQuery;
  /** Product being shown on a PRODUCT_DETAIL page, otherwise null. */
  product: StorefrontProduct | null;
  /** Set on the blog's own pages (`/blog`, `/blog/<slug>`): the list, or one post. `page` is then the home page without its sections. */
  blog?: { view: "list" } | { view: "post"; post: StorefrontPost };
  /** Prefix of every storefront URL (`/preview/<id>` for the draft preview, `` for a public host). */
  basePath: string;
  /** Resolves an internal path (e.g. "/products") against `basePath`. */
  href: (path: string) => string;
  /** Public URL of a stored image key, or null when it cannot be built (templates then show a placeholder). */
  mediaUrl: (key: string) => string | null;
  /**
   * Phase 3.3/3.4: true only on the LIVE public store (cart and checkout work there). Previews and theme demos leave it unset, so they
   * show no "add to cart" (nothing to buy in a draft).
   */
  commerce?: boolean;
}
