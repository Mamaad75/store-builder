import { describe, expect, it } from "vitest";
import { smsSettingsSchema } from "../platform/settings.js";
import { kindsForEvent, orderSmsPlatformSchema, plainToken, spacedToken, storeSmsSettingsSchema } from "./order-sms.js";

describe("order SMS rules (phase 3.6)", () => {
  it("events -> message kinds (owner decisions); a shopper's own cancellation sends nothing", () => {
    expect(kindsForEvent("order.placed", { orderId: "o1" })).toEqual(["SHOPPER_PLACED", "MERCHANT_NEW_ORDER"]);
    expect(kindsForEvent("order.status_changed", { to: "SHIPPED", actor: "MERCHANT" })).toEqual(["SHOPPER_SHIPPED"]);
    expect(kindsForEvent("order.status_changed", { to: "CANCELLED", actor: "MERCHANT" })).toEqual(["SHOPPER_CANCELLED"]);
    expect(kindsForEvent("order.status_changed", { to: "CANCELLED", actor: "CUSTOMER" })).toEqual([]);
    expect(kindsForEvent("order.status_changed", { to: "EXPIRED", actor: "SYSTEM" })).toEqual(["SHOPPER_EXPIRED"]);
    expect(kindsForEvent("order.status_changed", { to: "CONFIRMED", actor: "MERCHANT" })).toEqual([]);
    expect(kindsForEvent("order.receipt_submitted", {})).toEqual(["MERCHANT_RECEIPT"]);
    expect(kindsForEvent("order.receipt_rejected", {})).toEqual(["SHOPPER_RECEIPT_REJECTED"]);
    expect(kindsForEvent("store.published", {})).toEqual([]);
  });

  it("review 3.6: the store name loses links, domains, e-mails and digits; stale messages; the merchant's own approval", async () => {
    const { smsStoreName, stillRelevant } = await import("./order-sms.js");
    expect(smsStoreName("بانک ملت: به evil.ir بروید https://x.ir/a یا ۰۹۱۲۱۲۳۴۵۶۷ a@b.c")).toBe("بانک ملت به بروید یا");
    expect(smsStoreName("12345")).toBe("فروشگاه");
    expect(smsStoreName("چای سبز")).toBe("چای سبز");
    expect(stillRelevant("SHOPPER_PLACED", "CANCELLED")).toBe(false);
    expect(stillRelevant("SHOPPER_PLACED", "CONFIRMED")).toBe(true);
    expect(stillRelevant("SHOPPER_SHIPPED", "CONFIRMED")).toBe(false);
    expect(stillRelevant("MERCHANT_RECEIPT", "PLACED")).toBe(false);
    expect(kindsForEvent("order.placed", { orderId: "o", source: "receipt_approval" })).toEqual(["SHOPPER_PLACED"]);
  });

  it("Kavenegar token rules: no spaces in token/token2, at most 5 spaces in token10", () => {
    expect(plainToken("  a b  c ")).toBe("a_b_c");
    expect(spacedToken("فروشگاه بزرگ لوازم خانگی و برقی شهر تهران")).toBe("فروشگاه بزرگ لوازم خانگی و برقی_شهر_تهران");
    expect(spacedToken("چای سبز").split(" ")).toHaveLength(2);
    expect(spacedToken("x".repeat(200))).toHaveLength(100);
  });

  it("settings: older stored values read as off; store phone normalised; templates are names only", () => {
    const old = smsSettingsSchema.parse({ provider: "kavenegar", customerOtpEnabled: true, otpTemplate: "otp" });
    expect(old.orderSms).toMatchObject({ enabled: false, monthlyCapPerStore: 500 });
    expect(old.orderSms.templates.SHOPPER_PLACED).toBe("");
    expect(orderSmsPlatformSchema.safeParse({ templates: { SHOPPER_PLACED: "order placed!" } }).success).toBe(false);
    expect(orderSmsPlatformSchema.safeParse({ templates: { NOPE: "x" } }).success).toBe(false);
    expect(storeSmsSettingsSchema.parse({ enabled: true, merchantPhone: "۰۹۱۲ ۱۲۳ ۴۵۶۷" })).toEqual({ enabled: true, merchantPhone: "+989121234567" });
    expect(storeSmsSettingsSchema.parse({ enabled: false, merchantPhone: "" })).toEqual({ enabled: false, merchantPhone: null });
    expect(storeSmsSettingsSchema.safeParse({ enabled: true, merchantPhone: "021-12345678" }).success).toBe(false);
  });
});
