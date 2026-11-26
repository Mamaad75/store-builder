import { describe, expect, it } from "vitest";
import { combinations, initialFrom, labelOf, splitValues, toDrafts, type VariantRow } from "./variants-form";
import type { VariantView } from "@/client/api";

describe("splitValues", () => {
  it("splits on , ، ; and new lines, trims, drops blanks and repeats", () => {
    expect(splitValues("قرمز، آبی, سبز;  آبی\n\n  زرد  ")).toEqual(["قرمز", "آبی", "سبز", "زرد"]);
    expect(splitValues("  ,، ")).toEqual([]);
  });
});

describe("combinations", () => {
  it("builds every combination once, in a stable order, with the default price", () => {
    const r = combinations(["رنگ", "سایز"], ["قرمز، آبی", "S، M"], [], "100000");
    expect(r.ok && r.rows.map(labelOf)).toEqual(["قرمز / S", "قرمز / M", "آبی / S", "آبی / M"]);
    expect(r.ok && r.rows[0]).toEqual({ options: [{ name: "رنگ", value: "قرمز" }, { name: "سایز", value: "S" }], price: "100000", stock: "0", sku: "" });
  });
  it("keeps price, stock and sku of combinations that already existed", () => {
    const first = combinations(["رنگ"], ["قرمز"], [], "5");
    if (!first.ok) throw new Error("x");
    const edited: VariantRow[] = [{ ...first.rows[0]!, price: "777", stock: "9", sku: "RED-1" }];
    const next = combinations(["رنگ"], ["قرمز، آبی"], edited, "5");
    expect(next.ok && next.rows.map((r) => [labelOf(r), r.price, r.stock, r.sku])).toEqual([["قرمز", "777", "9", "RED-1"], ["آبی", "5", "0", ""]]);
  });
  it("refuses with a Persian reason: no values, blank or repeated names, too many options, more than 30 combinations", () => {
    for (const [names, vals] of [[["رنگ"], [""]], [[" "], ["x"]], [["رنگ", "رنگ"], ["a", "b"]], [["a", "b", "c", "d"], ["1", "1", "1", "1"]], [[], []]] as [string[], string[]][]) {
      const r = combinations(names, vals, [], "1");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/[؀-ۿ]/);
    }
    const big = combinations(["a", "b"], ["1،2،3،4،5،6", "1،2،3،4،5،6"], [], "1");
    expect(big.ok).toBe(false); // 36 > 30
    expect(combinations(["a", "b"], ["1،2،3،4،5،6", "1،2،3،4،5"], [], "1").ok).toBe(true); // exactly 30
  });
});

describe("toDrafts", () => {
  const row = (o: Partial<VariantRow> = {}): VariantRow => ({ options: [{ name: "رنگ", value: "قرمز" }], price: "۱٬۲۰۰", stock: "۵", sku: "", ...o });
  it("turns the text into integers (Persian digits and separators accepted); an empty sku is left out", () => {
    expect(toDrafts([row(), row({ options: [{ name: "رنگ", value: "آبی" }], sku: "BLUE.1" })])).toEqual({
      ok: true,
      variants: [
        { options: [{ name: "رنگ", value: "قرمز" }], price: 1200, stockQuantity: 5 },
        { options: [{ name: "رنگ", value: "آبی" }], price: 1200, stockQuantity: 5, sku: "BLUE.1" },
      ],
    });
  });
  it("names the combination whose price or stock is not a plain whole number", () => {
    const a = toDrafts([row({ price: "abc" })]);
    const b = toDrafts([row({ stock: "1.5" })]);
    expect(a).toMatchObject({ ok: false, error: expect.stringContaining("قرمز") });
    expect(b).toMatchObject({ ok: false, error: expect.stringContaining("موجودی") });
  });
});

describe("initialFrom", () => {
  const v = (id: string, options: { name: string; value: string }[], price: number, stock: number, sku: string | null = null): VariantView => ({ id, options, optionsKey: id, sku, price, stockQuantity: stock, position: 0 });
  it("an empty product starts with one empty option; existing variants give names, values and rows", () => {
    expect(initialFrom([])).toEqual({ names: ["رنگ"], valuesText: [""], rows: [] });
    const r = initialFrom([v("a", [{ name: "رنگ", value: "قرمز" }, { name: "سایز", value: "S" }], 10, 2, "R-S"), v("b", [{ name: "رنگ", value: "قرمز" }, { name: "سایز", value: "M" }], 12, 0)]);
    expect(r.names).toEqual(["رنگ", "سایز"]);
    expect(r.valuesText).toEqual(["قرمز", "S، M"]);
    expect(r.rows.map((x) => [labelOf(x), x.price, x.stock, x.sku])).toEqual([["قرمز / S", "10", "2", "R-S"], ["قرمز / M", "12", "0", ""]]);
  });
});
