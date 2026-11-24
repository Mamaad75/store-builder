import { describe, expect, it } from "vitest";
import { discountLabel } from "./discounts.js";

describe("discount labels (phase 5.1)", () => {
  it("reads like the merchant set it", () => {
    expect(discountLabel({ type: "FREE_SHIPPING", value: 0, maxDiscount: null })).toBe("ارسال رایگان");
    expect(discountLabel({ type: "PERCENT", value: 15, maxDiscount: 50_000 })).toBe("۱۵٪ (تا ۵۰٬۰۰۰ تومان)");
    expect(discountLabel({ type: "FIXED", value: 20_000, maxDiscount: null })).toBe("۲۰٬۰۰۰ تومان");
  });
});
