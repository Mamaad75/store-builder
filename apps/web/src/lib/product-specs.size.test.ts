import { describe, expect, it } from "vitest";
import { MAX_PRODUCTS_PER_STORE } from "@/modules/products/schemas";
import { storefrontProductSchema } from "@/templates/storefront-data";
import {
  MAX_SPEC_ROWS,
  SPEC_LABEL_MAX,
  SPEC_VALUE_MAX,
  SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT,
  SPECS_WORST_CASE_JSON_BYTES_PER_STORE,
  specsInputSchema,
} from "./product-specs";

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

/** The heaviest rows the validators accept: unique 40-unit labels and 120-unit values made of 3-byte characters (CJK). */
const worstRows = () =>
  Array.from({ length: MAX_SPEC_ROWS }, (_, i) => ({
    label: String.fromCodePoint(0x4e00 + i).repeat(SPEC_LABEL_MAX),
    value: String.fromCodePoint(0x4e00 + i).repeat(SPEC_VALUE_MAX),
  }));

describe("specification snapshot budget (the documented worst case is real, and is the real maximum)", () => {
  it("maximum-size specifications pass the owner-input validator unchanged (so nothing larger can ever be stored)", () => {
    const parsed = specsInputSchema.parse(worstRows());
    expect(parsed).toEqual(worstRows());
  });

  it("the worst case is exactly the documented 15,121 bytes per product and ~7.2 MiB for 500 products", () => {
    const b = bytes(specsInputSchema.parse(worstRows()));
    expect(b).toBe(SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT);
    expect(b).toBe(15_121);
    expect(MAX_PRODUCTS_PER_STORE).toBe(500);
    expect(MAX_PRODUCTS_PER_STORE * b).toBe(SPECS_WORST_CASE_JSON_BYTES_PER_STORE);
    expect(SPECS_WORST_CASE_JSON_BYTES_PER_STORE).toBe(7_560_500);
    expect(SPECS_WORST_CASE_JSON_BYTES_PER_STORE / 1024 / 1024).toBeLessThan(7.3);
  });

  it("no accepted input is heavier: quotes and backslashes (escaped to 2 bytes per unit) stay below the 3-byte worst case", () => {
    const heavy = Array.from({ length: MAX_SPEC_ROWS }, (_, i) => ({ label: `${i}\\`.padEnd(SPEC_LABEL_MAX, '"'), value: '"\\'.repeat(SPEC_VALUE_MAX / 2) }));
    const b = bytes(specsInputSchema.parse(heavy));
    expect(b).toBeLessThanOrEqual(SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT);
    // astral characters (emoji) are 2 UTF-16 units for 4 bytes: 2 bytes/unit, also below the 3-byte BMP worst case
    const emoji = Array.from({ length: MAX_SPEC_ROWS }, (_, i) => ({ label: `${String.fromCodePoint(0x1f600 + i)}`.repeat(SPEC_LABEL_MAX / 2), value: "😀".repeat(SPEC_VALUE_MAX / 2) }));
    expect(bytes(specsInputSchema.parse(emoji))).toBeLessThanOrEqual(SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT);
  });

  it("a worst-case product still satisfies the storefront contract, and its specs stay within the per-product budget", () => {
    const product = {
      id: "p", name: "ن".repeat(120), slug: "x", description: "د".repeat(5000), price: 1, stockQuantity: 1, categoryId: null, image: null,
      specs: worstRows(),
    };
    expect(storefrontProductSchema.safeParse(product).success).toBe(true);
    const specsBytes = bytes(product.specs);
    expect(specsBytes).toBeLessThanOrEqual(SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT);
    // For perspective: the description alone can already weigh about as much as the worst-case specs (5000 units x 3 bytes).
    expect(bytes(product.description.replace(/د/g, "一"))).toBe(15_002);
  });

  it("a typical product (a dozen short Persian rows) is far below 1 KiB, i.e. ~0.5 MB for 500 products", () => {
    const typical = Array.from({ length: 12 }, (_, i) => ({ label: `ویژگی ${i + 1}`, value: "۷ کیلوگرم" }));
    const b = bytes(typical);
    expect(b).toBeLessThan(1024);
    expect(b * MAX_PRODUCTS_PER_STORE).toBeLessThan(600_000);
  });
});
