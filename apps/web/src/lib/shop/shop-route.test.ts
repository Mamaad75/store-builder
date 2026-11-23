import { describe, expect, it } from "vitest";
import { shopApiPath } from "./shop-route";

describe("store-host shop API mapping", () => {
  it("forwards the shopper routes to the store named by the HOST", () => {
    expect(shopApiPath("shop", "/api/shop/cart")).toBe("/api/public/stores/shop/cart");
    expect(shopApiPath("shop", "/api/shop/cart/items")).toBe("/api/public/stores/shop/cart/items");
    expect(shopApiPath("shop", "/api/shop/checkout/quote")).toBe("/api/public/stores/shop/checkout/quote");
    expect(shopApiPath("shop", "/api/shop/checkout/orders")).toBe("/api/public/stores/shop/checkout/orders");
    const t = "a".repeat(43);
    expect(shopApiPath("shop", `/api/shop/checkout/orders/${t}/cancel`)).toBe(`/api/public/stores/shop/checkout/orders/${t}/cancel`);
    expect(shopApiPath("shop", "/api/shop/customer/orders/abc123/cancel")).toBe("/api/public/stores/shop/customer/orders/abc123/cancel");
  });

  it("forwards nothing else: no other store, no merchant or platform route, no traversal", () => {
    for (const p of [
      "/api/shop/../stores/x", "/api/shop/%2e%2e/stores", "/api/shop/stores/other/cart", "/api/shop/cart/../../stores",
      "/api/shop/", "/api/shop", "/api/shopx/cart", "/api/shop/cart/", "/api/shop/CART", "/api/shop/checkout/orders/short",
      "/api/shop/customer/orders/ABC", "/api/public/stores/other/cart",
    ]) expect(shopApiPath("shop", p), p).toBeNull();
  });
});
