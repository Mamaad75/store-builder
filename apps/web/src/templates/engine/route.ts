import type { StorefrontData, StorefrontPage, StorefrontProduct } from "../storefront-data";
import type { StorefrontQuery } from "../types";

export const PRODUCTS_PER_PAGE = 12;

export type StorefrontRoute =
  | { kind: "page"; page: StorefrontPage; product: StorefrontProduct | null; query: StorefrontQuery }
  | { kind: "not_found" };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Bounded, forgiving parse of the listing query: garbage never throws, it falls back to defaults. */
export function parseQuery(sp: SearchParams | undefined, data: StorefrontData): StorefrontQuery {
  const rawPage = first(sp?.page);
  const n = rawPage && /^\d{1,4}$/.test(rawPage) ? Number(rawPage) : 1;
  const rawCat = first(sp?.category);
  const category = rawCat && data.categories.some((c) => c.slug === rawCat) ? rawCat : undefined;
  return { page: Math.max(1, n), ...(category ? { category } : {}) };
}

const SEGMENT_PAGE = { products: "PRODUCTS", about: "ABOUT", contact: "CONTACT" } as const;

/**
 * Maps a URL (relative to the storefront base path) to a page of the validated data.
 * Public paths are fixed by page type (/, /products, /products/<slug>, /about, /contact) and do not
 * depend on the editable `page.slug`, so links stay stable.
 * Pages that are not part of the data (hidden or missing) are not found; unknown products are not found.
 */
export function resolveStorefrontRoute(data: StorefrontData, rawSegments: string[], sp?: SearchParams): StorefrontRoute {
  // Next hands over path segments percent-encoded (Persian slugs arrive as %DA%86...). Decode each one;
  // a malformed escape is simply a path that does not exist.
  const segments: string[] = [];
  for (const raw of rawSegments) {
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return { kind: "not_found" };
    }
  }
  const query = parseQuery(sp, data);
  const byType = (t: StorefrontPage["type"]) => data.pages.find((p) => p.type === t);

  if (segments.length === 0) {
    const page = byType("HOME");
    return page ? { kind: "page", page, product: null, query } : { kind: "not_found" };
  }
  const [head, second] = segments;
  if (segments.length === 1 && head && head in SEGMENT_PAGE) {
    const page = byType(SEGMENT_PAGE[head as keyof typeof SEGMENT_PAGE]);
    return page ? { kind: "page", page, product: null, query } : { kind: "not_found" };
  }
  if (segments.length === 2 && head === "products" && second) {
    const page = byType("PRODUCT_DETAIL");
    const product = data.products.find((p) => p.slug === second) ?? null;
    return page && product ? { kind: "page", page, product, query } : { kind: "not_found" };
  }
  return { kind: "not_found" };
}
