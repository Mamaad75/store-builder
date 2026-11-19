import type { CategoryDto, ProductDto, ProductListDto } from "@store-builder/shared/dto/index";
import type { ProductListParams } from "@store-builder/shared/modules/products/schemas";
import { enc, request } from "./core";

export type { CategoryDto, ProductDto, ProductListDto };

const base = (storeId: string) => `/api/stores/${enc(storeId)}`;

export const listCategories = (storeId: string) => request<CategoryDto[]>("GET", `${base(storeId)}/categories`);
export const createCategory = (storeId: string, input: unknown) => request<{ id: string }>("POST", `${base(storeId)}/categories`, { body: input });
export const updateCategory = (storeId: string, categoryId: string, input: unknown) => request<unknown>("PATCH", `${base(storeId)}/categories/${enc(categoryId)}`, { body: input });
export const deleteCategory = (storeId: string, categoryId: string, options: { moveProducts: boolean }) =>
  request<{ movedProducts: number }>("POST", `${base(storeId)}/categories/${enc(categoryId)}/delete`, { body: options });

export function listProducts(storeId: string, params: Partial<ProductListParams> = {}) {
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") query[k] = String(v);
  return request<ProductListDto>("GET", `${base(storeId)}/products`, { query });
}
export const getProduct = (storeId: string, productId: string) => request<ProductDto>("GET", `${base(storeId)}/products/${enc(productId)}`);
export const createProduct = (storeId: string, input: unknown) => request<ProductDto>("POST", `${base(storeId)}/products`, { body: input });
export const updateProduct = (storeId: string, productId: string, input: unknown) => request<ProductDto>("PATCH", `${base(storeId)}/products/${enc(productId)}`, { body: input });
export const changeProductStatus = (storeId: string, productId: string, status: string) => request<ProductDto>("POST", `${base(storeId)}/products/${enc(productId)}/status`, { body: { status } });
export const deleteProduct = (storeId: string, productId: string) => request("POST", `${base(storeId)}/products/${enc(productId)}/delete`);
