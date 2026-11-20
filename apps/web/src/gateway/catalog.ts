// Server-side READS of the API for rendering (ADR 0001). Writes happen in the browser: see src/client/api.ts.
import type { CategoryDto, ProductDto, ProductListDto } from "@store-builder/shared/dto/index";
import type { ProductListParams } from "@store-builder/shared/modules/products/schemas";
import { enc, request } from "./core";

export type { CategoryDto, ProductDto, ProductListDto };

const base = (storeId: string) => `/api/stores/${enc(storeId)}`;

export const listCategories = (storeId: string) => request<CategoryDto[]>("GET", `${base(storeId)}/categories`);
export function listProducts(storeId: string, params: Partial<ProductListParams> = {}) {
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") query[k] = String(v);
  return request<ProductListDto>("GET", `${base(storeId)}/products`, { query });
}
export const getProduct = (storeId: string, productId: string) => request<ProductDto>("GET", `${base(storeId)}/products/${enc(productId)}`);
