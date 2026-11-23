import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { send } from "./http";
import type { z } from "zod";
import type { cartViewDto, checkoutSummaryDto, placedOrderDto, shopperOrderDto } from "@store-builder/shared/api/schemas";

/**
 * The storefront's door to its own store's shopper routes (phases 3.3/3.4): same-origin `/api/shop/*` on the STORE host, which the web
 * proxy forwards to the API for the store named by the host. The cart and customer cookies are host-only cookies of this store.
 */
export type CartView = z.infer<typeof cartViewDto>;
export type CheckoutSummary = z.infer<typeof checkoutSummaryDto>;
export type PlacedOrder = z.infer<typeof placedOrderDto>;
export type ShopperOrder = z.infer<typeof shopperOrderDto>;

export const getCart = () => send<CartView>("GET", "/api/shop/cart");
export const addToCart = (productId: string, variantId: string | null, quantity: number) => send<CartView>("POST", "/api/shop/cart/items", { body: { productId, variantId, quantity } });
export const setCartLine = (productId: string, variantId: string | null, quantity: number) => send<CartView>("PUT", "/api/shop/cart/items", { body: { productId, variantId, quantity } });
export const quote = (body: unknown) => send<CheckoutSummary>("POST", "/api/shop/checkout/quote", { body });
export const placeOrder = (body: unknown) => send<PlacedOrder>("POST", "/api/shop/checkout/orders", { body });
export const getOrder = (token: string) => send<ShopperOrder>("GET", `/api/shop/checkout/orders/${encodeURIComponent(token)}`);
export const cancelOrder = (token: string) => send<ShopperOrder>("POST", `/api/shop/checkout/orders/${encodeURIComponent(token)}/cancel`);

/** A Persian sentence for any failure of a shop call (domain errors carry their own Persian message). */
export function problemText(e: unknown): string {
  if (e instanceof ValidationError) return Object.values(e.fieldErrors).flat()[0] ?? "اطلاعات واردشده را بررسی کنید.";
  if (e instanceof Error && /[\u0600-\u06FF]/.test(e.message)) return e.message;
  return "ارتباط با فروشگاه برقرار نشد؛ دوباره تلاش کنید.";
}
