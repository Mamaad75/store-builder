import { describe, expect, it } from "vitest";
import {
  addressInputSchema,
  cartLineInputSchema,
  normalizePostalCode,
  quoteShipping,
  replaceShippingMethodsSchema,
  shippingMethodInputSchema,
  type ShippingMethod,
} from "./checkout.js";
import { PROVINCES, PROVINCE_CODE_RE, isProvinceCode, provinceName } from "./provinces.js";

describe("provinces", () => {
  it("lists Iran's 31 provinces once each, codes in the shape the database checks, the capital first", () => {
    expect(PROVINCES).toHaveLength(31);
    expect(new Set(PROVINCES.map((p) => p.code)).size).toBe(31);
    expect(new Set(PROVINCES.map((p) => p.name)).size).toBe(31);
    for (const p of PROVINCES) {
      expect(p.code).toMatch(PROVINCE_CODE_RE);
      expect(p.cities.length).toBeGreaterThan(0);
    }
    expect(provinceName("tehran")).toBe("تهران");
    expect(PROVINCES.find((p) => p.code === "fars")!.cities[0]).toBe("شیراز");
    expect(isProvinceCode("atlantis")).toBe(false);
    expect(isProvinceCode(undefined)).toBe(false);
  });
});

describe("postal code", () => {
  it("accepts 10 digits typed in Persian, Arabic or ASCII digits, with spaces or dashes", () => {
    expect(normalizePostalCode("۱۳۸۴۵-۶۷۸۹۱")).toBe("1384567891");
    expect(normalizePostalCode("١٣٨٤٥ ٦٧٨٩١")).toBe("1384567891");
    expect(normalizePostalCode("1384567891")).toBe("1384567891");
  });
  it("refuses wrong lengths, letters, filler and non-strings", () => {
    for (const bad of ["123456789", "12345678901", "12345abcde", "0000000000", "1111111111", 1384567891, null, "1".repeat(40)]) {
      expect(normalizePostalCode(bad)).toBeNull();
    }
  });
});

describe("address", () => {
  const ok = { recipientName: " علي  رضايي ", phone: "۰۹۱۲ ۳۴۵ ۶۷۸۹", province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "۱۳۸۴۵۶۷۸۹۱" };
  it("normalises letters, spaces, the mobile (E.164) and the postal code", () => {
    const a = addressInputSchema.parse(ok);
    expect(a).toEqual({ ...ok, recipientName: "علی رضایی", phone: "+989123456789", postalCode: "1384567891" });
  });
  it("names every wrong field in Persian and refuses unknown fields", () => {
    const r = addressInputSchema.safeParse({ recipientName: "ع", phone: "123", province: "x", city: "", line: "کوتاه", postalCode: "12" });
    expect(r.success).toBe(false);
    const fields = Object.keys(r.error!.flatten().fieldErrors).sort();
    expect(fields).toEqual(["city", "line", "phone", "postalCode", "province", "recipientName"]);
    expect(addressInputSchema.safeParse({ ...ok, admin: true }).success).toBe(false);
  });
});

const method = (over: Partial<ShippingMethod> = {}): ShippingMethod => ({
  ...shippingMethodInputSchema.parse({ name: "پست", kind: "FLAT", price: 50_000 }),
  id: "m1",
  ...over,
});
const ctx = { province: "tehran", subtotal: 300_000, knownGrams: 0, unknownWeightUnits: 0 };

describe("shipping quote", () => {
  it("flat: the province price, else the base price; not offered outside its provinces; disabled = not offered", () => {
    const m = method({ provinces: ["tehran", "alborz"], provincePrices: [{ province: "tehran", price: 30_000 }] });
    expect(quoteShipping(m, ctx)!.cost).toBe(30_000);
    expect(quoteShipping(m, { ...ctx, province: "alborz" })!.cost).toBe(50_000);
    expect(quoteShipping(m, { ...ctx, province: "fars" })).toBeNull();
    expect(quoteShipping({ ...m, enabled: false }, ctx)).toBeNull();
  });

  it("weight: the base covers the first kilogram, every further started kilogram costs perKg; unknown weights use the default", () => {
    const m = method({ kind: "WEIGHT", price: 40_000, perKg: 10_000, defaultItemGrams: 500 });
    expect(quoteShipping(m, { ...ctx, knownGrams: 1000 })!.cost).toBe(40_000);
    expect(quoteShipping(m, { ...ctx, knownGrams: 1001 })!.cost).toBe(50_000);
    expect(quoteShipping(m, { ...ctx, knownGrams: 3500 })!.cost).toBe(70_000);
    expect(quoteShipping(m, { ...ctx, knownGrams: 0, unknownWeightUnits: 5 })!.cost).toBe(60_000); // 2.5 kg
    expect(quoteShipping(m, { ...ctx, knownGrams: 0 })!.cost).toBe(40_000);
  });

  it("free above an amount: exactly at the threshold is free and says why", () => {
    const m = method({ freeAbove: 300_000 });
    expect(quoteShipping(m, ctx)).toMatchObject({ cost: 0, freeByThreshold: true });
    expect(quoteShipping(m, { ...ctx, subtotal: 299_999 })).toMatchObject({ cost: 50_000, freeByThreshold: false });
  });

  it("pickup is always free and cannot be given a price", () => {
    expect(quoteShipping(method({ kind: "PICKUP", price: 0 }), ctx)!.cost).toBe(0);
    expect(shippingMethodInputSchema.safeParse({ name: "حضوری", kind: "PICKUP", price: 1000 }).success).toBe(false);
  });

  it("cash on delivery: only where enabled and in its provinces, with its fee", () => {
    const m = method({ cashOnDelivery: { enabled: true, provinces: ["tehran"], fee: 15_000 } });
    expect(quoteShipping(m, ctx)!.cashOnDelivery).toEqual({ available: true, fee: 15_000 });
    expect(quoteShipping(m, { ...ctx, province: "alborz" })!.cashOnDelivery).toEqual({ available: false, fee: 0 });
    expect(quoteShipping(method(), ctx)!.cashOnDelivery).toEqual({ available: false, fee: 0 });
  });
});

describe("shipping method input", () => {
  it("refuses perKg outside weight shipping, duplicate or unknown provinces and prices for provinces it does not serve", () => {
    const base = { name: "پیک", kind: "FLAT", price: 10 };
    expect(shippingMethodInputSchema.safeParse({ ...base, perKg: 5 }).success).toBe(false);
    expect(shippingMethodInputSchema.safeParse({ ...base, provinces: ["tehran", "tehran"] }).success).toBe(false);
    expect(shippingMethodInputSchema.safeParse({ ...base, provinces: ["mars"] }).success).toBe(false);
    expect(shippingMethodInputSchema.safeParse({ ...base, provinces: ["tehran"], provincePrices: [{ province: "fars", price: 1 }] }).success).toBe(false);
    expect(shippingMethodInputSchema.safeParse({ ...base, price: -1 }).success).toBe(false);
    expect(shippingMethodInputSchema.safeParse({ ...base, price: 1.5 }).success).toBe(false);
    expect(shippingMethodInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
  it("caps the number of methods", () => {
    const one = { name: "پست", kind: "FLAT", price: 1 };
    expect(replaceShippingMethodsSchema.safeParse({ methods: Array(20).fill(one) }).success).toBe(true);
    expect(replaceShippingMethodsSchema.safeParse({ methods: Array(21).fill(one) }).success).toBe(false);
  });
});

describe("cart line input", () => {
  it("accepts ids and whole quantities within bounds; variant defaults to none", () => {
    expect(cartLineInputSchema.parse({ productId: "p1", quantity: 2 })).toEqual({ productId: "p1", variantId: null, quantity: 2 });
    for (const bad of [{ productId: "P-1", quantity: 1 }, { productId: "p1", quantity: 1001 }, { productId: "p1", quantity: 1.5 }, { productId: "p1", quantity: -1 }, { productId: "p1", quantity: 1, price: 1 }]) {
      expect(cartLineInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});
