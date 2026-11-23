import { describe, expect, it } from "vitest";
import { can } from "../access/permissions.js";
import { ORDER_STATUSES, canTransition, nextStatuses, orderTransitionSchema, placeOrderSchema, restocksOn } from "./orders.js";

describe("order life cycle", () => {
  it("the merchant moves PLACED -> CONFIRMED -> SHIPPED -> DELIVERED and can cancel until shipped", () => {
    expect(nextStatuses("MERCHANT", "PLACED")).toEqual(["CONFIRMED", "CANCELLED"]);
    expect(nextStatuses("MERCHANT", "CONFIRMED")).toEqual(["SHIPPED", "CANCELLED"]);
    expect(nextStatuses("MERCHANT", "SHIPPED")).toEqual(["DELIVERED"]);
    expect(nextStatuses("MERCHANT", "DELIVERED")).toEqual([]);
    expect(nextStatuses("MERCHANT", "CANCELLED")).toEqual([]);
    expect(canTransition("MERCHANT", "SHIPPED", "CANCELLED")).toBe(false);
    expect(canTransition("MERCHANT", "PLACED", "DELIVERED")).toBe(false); // no skipping
  });

  it("a shopper can only cancel, and only before the store confirms", () => {
    for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) expect(canTransition("CUSTOMER", from, to)).toBe(from === "PLACED" && to === "CANCELLED");
  });

  it("only cancelling gives stock back", () => {
    expect(ORDER_STATUSES.filter(restocksOn)).toEqual(["CANCELLED"]);
  });

  it("orders are personal data: owner and manager only", () => {
    expect([can("OWNER", "orders.manage"), can("MANAGER", "orders.view"), can("MANAGER", "orders.manage"), can("OPERATOR", "orders.view")]).toEqual([true, true, true, false]);
  });
});

describe("order input", () => {
  const ok = { requestKey: "k".repeat(16), shippingMethodId: "m1", paymentMethod: "COD" };
  it("needs a request key and a shipping method; only cash on delivery for now; never a price", () => {
    expect(placeOrderSchema.parse(ok)).toMatchObject({ note: "" });
    expect(placeOrderSchema.safeParse({ ...ok, requestKey: "short" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...ok, paymentMethod: "ONLINE" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...ok, total: 1 }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...ok, shippingMethodId: undefined }).success).toBe(false);
  });
  it("a note keeps line breaks but no other control characters, at most 500 characters", () => {
    expect(placeOrderSchema.parse({ ...ok, note: "زنگ\nنزنید" }).note).toBe("زنگ\nنزنید");
    expect(placeOrderSchema.safeParse({ ...ok, note: "a\u0007b" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...ok, note: "x".repeat(501) }).success).toBe(false);
    expect(orderTransitionSchema.safeParse({ to: "SHIPPED" }).success).toBe(true);
    expect(orderTransitionSchema.safeParse({ to: "LOST" }).success).toBe(false);
  });
});
