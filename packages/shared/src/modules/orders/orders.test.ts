import { describe, expect, it } from "vitest";
import { can } from "../access/permissions.js";
import { AUTHORITY_RE, GATEWAY_CREDENTIAL_RE, GATEWAY_TOMAN_RANGE, MAX_ONLINE_TOMAN, ORDER_STATUSES, ZARINPAL_MERCHANT_ID_RE, canTransition, nextStatuses, orderTransitionSchema, placeOrderSchema, restocksOn, tomanToRial, verifyPaymentSchema } from "./orders.js";

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

  it("a shopper can only cancel, and only before paying or before the store confirms", () => {
    for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) expect(canTransition("CUSTOMER", from, to)).toBe((from === "PLACED" || from === "AWAITING_PAYMENT") && to === "CANCELLED");
  });

  it("only the payment flow moves an unpaid order to PLACED or EXPIRED; the merchant can only cancel it", () => {
    expect(nextStatuses("MERCHANT", "AWAITING_PAYMENT")).toEqual(["CANCELLED"]);
    for (const actor of ["CUSTOMER", "MERCHANT"] as const) {
      expect(canTransition(actor, "AWAITING_PAYMENT", "PLACED")).toBe(false);
      for (const from of ORDER_STATUSES) expect(canTransition(actor, from, "EXPIRED")).toBe(false);
    }
    expect(nextStatuses("MERCHANT", "EXPIRED")).toEqual([]);
  });

  it("cancelling and expiring give stock back", () => {
    expect(ORDER_STATUSES.filter(restocksOn)).toEqual(["CANCELLED", "EXPIRED"]);
  });

  it("orders are personal data: owner and manager only", () => {
    expect([can("OWNER", "orders.manage"), can("MANAGER", "orders.view"), can("MANAGER", "orders.manage"), can("OPERATOR", "orders.view")]).toEqual([true, true, true, false]);
  });
});

describe("order input", () => {
  const ok = { requestKey: "k".repeat(16), shippingMethodId: "m1", paymentMethod: "COD" };
  it("needs a request key, a shipping method and a known payment method; never a price", () => {
    expect(placeOrderSchema.parse(ok)).toMatchObject({ note: "" });
    expect(placeOrderSchema.safeParse({ ...ok, requestKey: "short" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...ok, paymentMethod: "ONLINE" }).success).toBe(true);
    expect(placeOrderSchema.safeParse({ ...ok, paymentMethod: "CARD" }).success).toBe(false);
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

describe("online payment helpers (phase 3.5)", () => {
  it("rial for the gateway, Zarinpal's limits and formats", () => {
    expect(tomanToRial(125_000)).toBe(1_250_000);
    expect(tomanToRial(MAX_ONLINE_TOMAN)).toBe(4_000_000_000);
    expect(AUTHORITY_RE.test("A0000000000000000000000000000wwOGYpd")).toBe(true);
    expect(AUTHORITY_RE.test("S0000000000000000000000000000wwOGYpd")).toBe(true);
    expect(AUTHORITY_RE.test("B0000000000000000000000000000wwOGYpd")).toBe(false);
    expect(AUTHORITY_RE.test("A000")).toBe(false);
    expect(ZARINPAL_MERCHANT_ID_RE.test("1344b5d4-0048-11e8-94db-005056a205be")).toBe(true);
    expect(ZARINPAL_MERCHANT_ID_RE.test("not-a-uuid")).toBe(false);
    expect(verifyPaymentSchema.safeParse({ authority: "A0000000000000000000000000000wwOGYpd", status: "OK" }).success).toBe(true);
    expect(verifyPaymentSchema.safeParse({ authority: "A0000000000000000000000000000wwOGYpd", status: "MAYBE" }).success).toBe(false);
  });

  it("D35c-1: gateways: return forms, credentials and amount ranges", () => {
    expect(verifyPaymentSchema.parse({ authority: "A0000000000000000000000000000wwOGYpd", status: "OK" })).toEqual({ gateway: "ZARINPAL", authority: "A0000000000000000000000000000wwOGYpd", status: "OK" });
    expect(verifyPaymentSchema.parse({ gateway: "AQAYEPARDAKHT", authority: "62B827B7E1ECBLLAZ555", status: "1" }).status).toBe("OK");
    expect(verifyPaymentSchema.parse({ gateway: "AQAYEPARDAKHT", authority: "62B827B7E1ECBLLAZ555", status: "0" }).status).toBe("NOK");
    expect(verifyPaymentSchema.safeParse({ gateway: "AQAYEPARDAKHT", authority: "A0000000000000000000000000000wwOGYpd!", status: "1" }).success).toBe(false);
    expect(verifyPaymentSchema.safeParse({ gateway: "ZARINPAL", authority: "62B827B7E1ECBLLAZ555", status: "OK" }).success).toBe(false);
    expect(verifyPaymentSchema.safeParse({ gateway: "PAYPAL", authority: "62B827B7E1ECBLLAZ555", status: "OK" }).success).toBe(false);
    expect(GATEWAY_CREDENTIAL_RE.AQAYEPARDAKHT.test("D45DE2605E6E6F98")).toBe(true);
    expect(GATEWAY_CREDENTIAL_RE.AQAYEPARDAKHT.test("pin with space")).toBe(false);
    expect(GATEWAY_TOMAN_RANGE.AQAYEPARDAKHT).toEqual([1_000, 400_000_000]);
    expect(placeOrderSchema.safeParse({ requestKey: "r".repeat(20), shippingMethodId: "m1", paymentMethod: "COD", gateway: "ZARINPAL" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ requestKey: "r".repeat(20), shippingMethodId: "m1", paymentMethod: "ONLINE", gateway: "AQAYEPARDAKHT" }).success).toBe(true);
  });
});
