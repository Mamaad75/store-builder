import { describe, expect, it } from "vitest";
import { monthStart, recipientOf, tokensFor } from "./order-sms.js";

describe("order SMS content (phase 3.6)", () => {
  const o = { number: 42, total: 230_000, storeName: "فروشگاه چای سبز ممتاز ایرانی خوب", link: "https://chai.example.ir/orders/abc_DEF-123" };
  it("the shopper gets the number, the link and the store name; the merchant the number and the total; nothing else", () => {
    expect(recipientOf("SHOPPER_SHIPPED")).toBe("shopper");
    expect(recipientOf("MERCHANT_NEW_ORDER")).toBe("merchant");
    expect(tokensFor("SHOPPER_PLACED", o)).toEqual({ token: "42", token2: o.link, token10: "فروشگاه چای سبز ممتاز ایرانی خوب" });
    expect(tokensFor("MERCHANT_NEW_ORDER", o)).toEqual({ token: "42", token2: "230000", token10: "فروشگاه چای سبز ممتاز ایرانی خوب" });
    expect(tokensFor("SHOPPER_PLACED", { ...o, link: null })).toEqual({ token: "42", token10: "فروشگاه چای سبز ممتاز ایرانی خوب" });
  });
  it("review 3.6: a link too long for the provider is never cut; the store name is cleaned", () => {
    const long = `http://${"a".repeat(30)}.storebuilder-platform.ir/o/${"t".repeat(43)}`;
    expect(tokensFor("SHOPPER_PLACED", { ...o, link: long })).toBe("link_too_long");
    expect(tokensFor("SHOPPER_PLACED", { ...o, storeName: "بانک ملی: به bank-melli.co.ir بروید" })).toMatchObject({ token10: "بانک ملی به بروید" });
  });
  it("the month starts on the 1st (UTC)", () => {
    expect(monthStart(new Date("2026-11-24T22:10:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
