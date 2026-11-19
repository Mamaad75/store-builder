import { PRODUCT_PAGE_SIZE_DEFAULT, type ProductListParams } from "./schemas";

export const storeUrl = (storeId: string) => `/dashboard/stores/${encodeURIComponent(storeId)}`;
export const productsUrl = (storeId: string) => `${storeUrl(storeId)}/products`;
export const productUrl = (storeId: string, productId: string) => `${productsUrl(storeId)}/${encodeURIComponent(productId)}`;
export const categoriesUrl = (storeId: string) => `${storeUrl(storeId)}/categories`;

/** Product list URL that keeps the active search/filter/page and omits defaults. `extra` adds e.g. `notice`. */
export function buildProductsUrl(
  storeId: string,
  params: Partial<ProductListParams> = {},
  extra: Record<string, string> = {},
): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.category) sp.set("category", params.category);
  if (params.status) sp.set("status", params.status);
  if (params.pageSize && params.pageSize !== PRODUCT_PAGE_SIZE_DEFAULT) sp.set("pageSize", String(params.pageSize));
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${productsUrl(storeId)}?${qs}` : productsUrl(storeId);
}
