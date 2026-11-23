import { describe, expect, it } from "vitest";
import { optionsKeyOf, replaceVariantsSchema, variantSetProblem, variantSummary, type VariantInput } from "./variants.js";

const v = (opts: [string, string][], price = 100, stockQuantity = 1, sku?: string): VariantInput => ({ options: opts.map(([name, value]) => ({ name, value })), price, stockQuantity, ...(sku ? { sku } : {}) });

describe("product variants (phase 3.2)", () => {
  it("normalises option text (Arabic letters, spaces) so the same combination is recognised", () => {
    const r = replaceVariantsSchema.parse({ variants: [{ options: [{ name: " رنگ ", value: "مشكي" }], price: 1000, stockQuantity: 2 }] });
    expect(r.variants[0]!.options[0]).toEqual({ name: "رنگ", value: "مشکی" });
    expect(optionsKeyOf(r.variants[0]!.options)).toBe('[["رنگ","مشکی"]]');
  });
  it("refuses bad shapes: no options, too many options, negative stock, decimals, extra fields, more than 30 variants", () => {
    for (const bad of [
      { options: [], price: 1, stockQuantity: 1 },
      { options: [1, 2, 3, 4].map((i) => ({ name: `n${i}`, value: "x" })), price: 1, stockQuantity: 1 },
      { options: [{ name: "a", value: "b" }], price: 1, stockQuantity: -1 },
      { options: [{ name: "a", value: "b" }], price: 1.5, stockQuantity: 1 },
      { options: [{ name: "a", value: "b" }], price: 1, stockQuantity: 1, extra: true },
      { options: [{ name: "a", value: "b" }], price: 1, stockQuantity: 1, sku: "a b" },
      // regression (security re-review 3.2): control characters would blow up the stored combination key
      { options: [{ name: "a\u0001", value: "b" }], price: 1, stockQuantity: 1 },
      { options: [{ name: "a", value: "\u0000" }], price: 1, stockQuantity: 1 },
      { options: [{ name: "a", value: "\ud800" }], price: 1, stockQuantity: 1 },
    ])
      expect(replaceVariantsSchema.safeParse({ variants: [bad] }).success, JSON.stringify(bad)).toBe(false);
    expect(replaceVariantsSchema.safeParse({ variants: Array.from({ length: 31 }, (_, i) => v([["n", `x${i}`]])) }).success).toBe(false);
  });
  it("set rules: same option names in the same order, each combination once, unique names and SKUs", () => {
    expect(variantSetProblem([v([["رنگ", "قرمز"], ["سایز", "M"]]), v([["رنگ", "آبی"], ["سایز", "M"]])])).toBeNull();
    expect(variantSetProblem([v([["رنگ", "قرمز"]]), v([["سایز", "M"]])])).toBe("names_differ");
    expect(variantSetProblem([v([["رنگ", "قرمز"], ["سایز", "M"]]), v([["سایز", "M"], ["رنگ", "قرمز"]])])).toBe("names_differ");
    expect(variantSetProblem([v([["رنگ", "قرمز"]]), v([["رنگ", "قرمز"]])])).toBe("duplicate_combination");
    expect(variantSetProblem([v([["رنگ", "قرمز"], ["رنگ", "آبی"]])])).toBe("duplicate_option_name");
    expect(variantSetProblem([v([["رنگ", "قرمز"]], 1, 1, "A1"), v([["رنگ", "آبی"]], 1, 1, "A1")])).toBe("duplicate_sku");
    expect(variantSetProblem([])).toBeNull();
    expect(variantSetProblem([v([["رنگ", "قرمز"]], 1, 600_000), v([["رنگ", "آبی"]], 1, 400_000)])).toBeNull();
    expect(variantSetProblem([v([["رنگ", "قرمز"]], 1, 600_000), v([["رنگ", "آبی"]], 1, 400_001)])).toBe("stock_total");
  });
  it("regression (security review 3.2): separators inside names or values cannot make two combinations share a key", () => {
    const a = optionsKeyOf([{ name: "a", value: "b|c=d" }]);
    const b = optionsKeyOf([{ name: "a", value: "b" }, { name: "c", value: "d" }]);
    expect(a).not.toBe(b);
    expect(variantSetProblem([v([["a", "x=y|z"]]), v([["a", "x"]])])).toBeNull();
  });
  it("the product shows the lowest price and the summed stock", () => {
    expect(variantSummary([])).toBeNull();
    expect(variantSummary([{ price: 300, stockQuantity: 2 }, { price: 200, stockQuantity: 0 }, { price: 250, stockQuantity: 5 }])).toEqual({ price: 200, stockQuantity: 7 });
  });
});
