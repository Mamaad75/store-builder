import type { StorefrontData, StorefrontPage, StorefrontProduct } from "../storefront-data.js";
import { PRODUCT_SORTS, type ProductSort, type RenderContext, type StorefrontQuery } from "../context-types.js";
import { makeSearchKey, normalizeFa } from "../../lib/text.js";
import { filledInfoPages } from "../../modules/stores/info-pages.js";

export const PRODUCTS_PER_PAGE = 12;
/** Longest search text a listing accepts (longer input is cut, never rejected). */
export const SEARCH_MAX = 60;

export type StorefrontRoute =
  | { kind: "page"; page: StorefrontPage; product: StorefrontProduct | null; query: StorefrontQuery; blog?: RenderContext["blog"]; info?: RenderContext["info"] }
  | { kind: "not_found" };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Bounded, forgiving parse of the listing query: garbage never throws, it falls back to defaults. */
export function parseQuery(sp: SearchParams | undefined, data: StorefrontData): StorefrontQuery {
  const rawPage = first(sp?.page);
  const n = rawPage && /^\d{1,4}$/.test(rawPage) ? Number(rawPage) : 1;
  const rawCat = first(sp?.category);
  const category = rawCat && data.categories.some((c) => c.slug === rawCat) ? rawCat : undefined;
  // Search text: display-normalised and cut; a query with nothing searchable left (only spaces or marks) is no query.
  const rawQ = first(sp?.q);
  const q = rawQ ? normalizeFa(rawQ.slice(0, 200)).slice(0, SEARCH_MAX).trim() : "";
  const rawSort = first(sp?.sort);
  const sort = (PRODUCT_SORTS as readonly string[]).includes(rawSort ?? "") ? (rawSort as ProductSort) : undefined;
  return { page: Math.max(1, n), ...(category ? { category } : {}), ...(q && makeSearchKey(q) ? { q } : {}), ...(sort ? { sort } : {}) };
}

/**
 * The page object behind the blog and the information pages (they are not pages of the store's own page list). It is typed CONTACT with no sections on
 * purpose: the themes add a fallback heading to a home or about page that has no hero/text section, and these pages draw their own heading; a contact page
 * has no such rule. Nothing renders its sections; it only gives the theme's layout a page to be "on".
 */
const shellPage = (title: string): StorefrontPage => ({ type: "CONTACT", title: title.slice(0, 80) || "صفحه", slug: "content", position: 0, sections: [] });

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
  // The blog: only when the store has published posts; rendered inside the theme's own layout (the page is the home page without sections).
  if (head === "blog" && (data.posts?.length ?? 0) > 0 && segments.length <= 2) {
    if (segments.length === 1) return { kind: "page", page: shellPage("وبلاگ"), product: null, query, blog: { view: "list" } };
    const post = data.posts!.find((p) => p.slug === second);
    return post ? { kind: "page", page: shellPage(post.title), product: null, query, blog: { view: "post", post } } : { kind: "not_found" };
  }
  // Information pages: only those with text. Rendered in the theme's layout, like the blog.
  if (head === "info" && segments.length === 2 && second) {
    const found = filledInfoPages(data.store.infoPages).find((p) => p.key === second);
    return found ? { kind: "page", page: shellPage(found.title), product: null, query, info: found } : { kind: "not_found" };
  }
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
