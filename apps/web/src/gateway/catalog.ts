// Server-side READS of the API for rendering (ADR 0001). Writes happen in the browser: see src/client/api.ts.
import type { CategoryDto, ProductDto, ProductListDto } from "@store-builder/shared/dto/index";
import type { ProductListParams } from "@store-builder/shared/modules/products/schemas";
import type { z } from "zod";
import type { currentRatesDto, priceLinkDto, variantDto } from "@store-builder/shared/api/schemas";
import { enc, request } from "./core";

type VariantDto = z.infer<typeof variantDto>;
type PriceLinkDto = z.infer<typeof priceLinkDto>;
type CurrentRatesDto = z.infer<typeof currentRatesDto>;

export type { CategoryDto, ProductDto, ProductListDto, VariantDto, PriceLinkDto, CurrentRatesDto };

const base = (storeId: string) => `/api/stores/${enc(storeId)}`;

export const listCategories = (storeId: string) => request<CategoryDto[]>("GET", `${base(storeId)}/categories`);
export function listProducts(storeId: string, params: Partial<ProductListParams> = {}) {
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") query[k] = String(v);
  return request<ProductListDto>("GET", `${base(storeId)}/products`, { query });
}
export const getProduct = (storeId: string, productId: string) => request<ProductDto>("GET", `${base(storeId)}/products/${enc(productId)}`);

/** Phase 3.2 / 3.2b: a product's variants, its price links and today's rates (the product page shows and edits them). */
export const listVariants = (storeId: string, productId: string) => request<VariantDto[]>("GET", `${base(storeId)}/products/${enc(productId)}/variants`);
export const listPriceLinks = (storeId: string, productId: string) => request<PriceLinkDto[]>("GET", `${base(storeId)}/products/${enc(productId)}/price-links`);
export const getCurrentRates = (storeId: string) => request<CurrentRatesDto>("GET", `${base(storeId)}/rates`);
