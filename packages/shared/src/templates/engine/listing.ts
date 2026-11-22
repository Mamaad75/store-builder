import { makeSearchKey } from "../../lib/text.js";
import type { ProductSort, RenderContext } from "../context-types.js";
import type { StorefrontProduct } from "../storefront-data.js";
import { PRODUCTS_PER_PAGE } from "./route.js";

/** Pure view helpers shared by templates; no data access. */

/** Words of a search, normalised like the haystack (Persian letters, ASCII digits, ZWNJ as space); at most 6 are used. */
const searchWords = (q: string) => makeSearchKey(q).split(" ").filter(Boolean).slice(0, 6);

/** What a product is found by: its name, its category's name and its specification values (not the long description). */
function haystack(ctx: RenderContext, p: StorefrontProduct): string {
  return makeSearchKey([p.name, categoryOf(ctx, p.categoryId)?.name ?? "", ...p.specs.map((s) => s.value)].join(" "));
}

/** Stable sorts (Array.prototype.sort is stable): ties keep the store's own order. */
const SORTERS: Record<ProductSort, (a: StorefrontProduct, b: StorefrontProduct) => number> = {
  cheap: (a, b) => a.price - b.price,
  expensive: (a, b) => b.price - a.price,
  available: (a, b) => Number(b.stockQuantity > 0) - Number(a.stockQuantity > 0),
};

export function listProducts(ctx: RenderContext) {
  const { data, query } = ctx;
  const category = query.category ? data.categories.find((c) => c.slug === query.category) : undefined;
  let filtered = category ? data.products.filter((p) => p.categoryId === category.id) : data.products;
  const words = query.q ? searchWords(query.q) : [];
  if (words.length > 0) filtered = filtered.filter((p) => ((h) => words.every((w) => h.includes(w)))(haystack(ctx, p)));
  if (query.sort) filtered = [...filtered].sort(SORTERS[query.sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  const page = Math.min(query.page, totalPages);
  return {
    category,
    q: words.length > 0 ? query.q : undefined,
    sort: query.sort,
    total: filtered.length,
    page,
    totalPages,
    items: filtered.slice((page - 1) * PRODUCTS_PER_PAGE, page * PRODUCTS_PER_PAGE),
  };
}

export function featuredProducts(ctx: RenderContext, limit: number) {
  return ctx.data.products.slice(0, limit);
}

/** Products of one category in the store's order (a home-page rail per category). */
export function productsInCategory(ctx: RenderContext, categoryId: string, limit: number) {
  return ctx.data.products.filter((p) => p.categoryId === categoryId).slice(0, limit);
}

/** "Similar products" for a product page: same category first, then the rest of the store; never the product itself. */
export function relatedProducts(ctx: RenderContext, product: StorefrontProduct, limit: number) {
  const others = ctx.data.products.filter((p) => p.id !== product.id);
  const same = product.categoryId ? others.filter((p) => p.categoryId === product.categoryId) : [];
  return [...same, ...others.filter((p) => !same.includes(p))].slice(0, limit);
}

export function categoryOf(ctx: RenderContext, categoryId: string | null) {
  return categoryId ? (ctx.data.categories.find((c) => c.id === categoryId) ?? null) : null;
}

export function listUrl(ctx: RenderContext, params: { category?: string; page?: number; q?: string; sort?: ProductSort }): string {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  if (params.category) q.set("category", params.category);
  if (params.sort) q.set("sort", params.sort);
  if (params.page && params.page > 1) q.set("page", String(params.page));
  const s = q.toString();
  const base = ctx.href("/products"); // may already carry a query (candidate-theme preview)
  return base + (s ? `${base.includes("?") ? "&" : "?"}${s}` : "");
}

/**
 * A GET form that targets an internal path. Browsers DROP the query of a GET form's action, so the query the engine
 * carries on every link (candidate-theme preview: `theme=<key>`) is returned as hidden fields instead.
 */
export function formTarget(ctx: RenderContext, path: string): { action: string; hidden: [string, string][] } {
  const [action, query = ""] = ctx.href(path).split("?", 2) as [string, string?];
  return { action, hidden: [...new URLSearchParams(query).entries()] };
}

/** Image of a section (`imageId` -> contract `images` map -> public URL), or null for the placeholder. */
export function sectionImage(ctx: RenderContext, imageId: string | null): { url: string; width: number; height: number } | null {
  if (!imageId) return null;
  const ref = ctx.data.images[imageId];
  const url = ref ? ctx.mediaUrl(ref.key) : null;
  return ref && url ? { url, width: ref.width, height: ref.height } : null;
}
