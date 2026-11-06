import type { RenderContext } from "../types";
import { PRODUCTS_PER_PAGE } from "./route";

/** Pure view helpers shared by templates; no data access. */
export function listProducts(ctx: RenderContext) {
  const { data, query } = ctx;
  const category = query.category ? data.categories.find((c) => c.slug === query.category) : undefined;
  const filtered = category ? data.products.filter((p) => p.categoryId === category.id) : data.products;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  const page = Math.min(query.page, totalPages);
  return {
    category,
    total: filtered.length,
    page,
    totalPages,
    items: filtered.slice((page - 1) * PRODUCTS_PER_PAGE, page * PRODUCTS_PER_PAGE),
  };
}

export function featuredProducts(ctx: RenderContext, limit: number) {
  return ctx.data.products.slice(0, limit);
}

export function categoryOf(ctx: RenderContext, categoryId: string | null) {
  return categoryId ? (ctx.data.categories.find((c) => c.id === categoryId) ?? null) : null;
}

export function listUrl(ctx: RenderContext, params: { category?: string; page?: number }): string {
  const q = new URLSearchParams();
  if (params.category) q.set("category", params.category);
  if (params.page && params.page > 1) q.set("page", String(params.page));
  const s = q.toString();
  return ctx.href("/products") + (s ? `?${s}` : "");
}
