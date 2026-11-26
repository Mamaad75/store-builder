import { MAX_OPTIONS, MAX_VARIANTS_PER_PRODUCT, optionsKeyOf } from "@store-builder/shared/modules/inventory/variants";
import type { VariantDraft, VariantView } from "@/client/api";
import { asciiNumber, parseScaled } from "./price-link-form";

/**
 * The variants editor's maths, pure so it is tested without a browser: option names and typed values become every combination (each once,
 * at most 30), existing prices and stock survive a regeneration, and the table's text becomes the integer payload the API wants.
 */
export interface VariantRow {
  /** The combination, one value per option name (same order as the names). */
  options: { name: string; value: string }[];
  price: string;
  stock: string;
  sku: string;
}

/** "قرمز، آبی, سبز" -> ["قرمز","آبی","سبز"]: separators are , ، ; and new lines; blanks and repeats dropped. */
export function splitValues(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,،;\n]/)) {
    const v = part.trim().replace(/\s+/g, " ");
    if (v) seen.add(v);
  }
  return [...seen];
}

export type Combos = { ok: true; rows: VariantRow[] } | { ok: false; error: string };

/** Every combination of the typed values, keeping price/stock/sku of combinations that already exist. */
export function combinations(names: string[], valuesText: string[], previous: VariantRow[], defaultPrice: string): Combos {
  const cleanNames = names.map((n) => n.trim().replace(/\s+/g, " "));
  if (cleanNames.length === 0 || cleanNames.length > MAX_OPTIONS) return { ok: false, error: `بین یک تا ${MAX_OPTIONS} ویژگی بگذارید.` };
  if (cleanNames.some((n) => !n)) return { ok: false, error: "نام هر ویژگی را بنویسید (مثلاً رنگ، سایز)." };
  if (new Set(cleanNames).size !== cleanNames.length) return { ok: false, error: "نام ویژگی‌ها نباید تکراری باشد." };
  const lists = valuesText.map(splitValues);
  if (lists.some((l) => l.length === 0)) return { ok: false, error: "برای هر ویژگی حداقل یک مقدار بنویسید (با ویرگول جدا کنید)." };
  const total = lists.reduce((n, l) => n * l.length, 1);
  if (total > MAX_VARIANTS_PER_PRODUCT) return { ok: false, error: `این مقادیر ${total.toLocaleString("fa-IR")} ترکیب می‌سازند؛ حداکثر ${MAX_VARIANTS_PER_PRODUCT.toLocaleString("fa-IR")} ترکیب مجاز است.` };
  let acc: { name: string; value: string }[][] = [[]];
  cleanNames.forEach((name, i) => {
    acc = acc.flatMap((prefix) => lists[i]!.map((value) => [...prefix, { name, value }]));
  });
  const old = new Map(previous.map((r) => [optionsKeyOf(r.options), r]));
  return { ok: true, rows: acc.map((options) => old.get(optionsKeyOf(options)) ?? { options, price: defaultPrice, stock: "0", sku: "" }) };
}

export const labelOf = (r: { options: { name: string; value: string }[] }): string => r.options.map((o) => o.value).join(" / ");

export type Draft = { ok: true; variants: VariantDraft[] } | { ok: false; error: string };

/** The table's text as the API payload; the first problem is reported with the combination it belongs to. */
export function toDrafts(rows: VariantRow[]): Draft {
  const out: VariantDraft[] = [];
  for (const r of rows) {
    const price = parseScaled(r.price, 0);
    const stock = parseScaled(r.stock, 0);
    if (price === null) return { ok: false, error: `قیمت «${labelOf(r)}» را به تومان و به‌صورت عدد صحیح وارد کنید.` };
    if (stock === null) return { ok: false, error: `موجودی «${labelOf(r)}» را به‌صورت عدد صحیح وارد کنید.` };
    const sku = asciiNumber(r.sku).trim();
    out.push({ options: r.options, price, stockQuantity: stock, ...(sku ? { sku } : {}) });
  }
  return { ok: true, variants: out };
}

/** Starting point from what the product already has: names, the values used for each, and the rows. */
export function initialFrom(variants: VariantView[]): { names: string[]; valuesText: string[]; rows: VariantRow[] } {
  if (variants.length === 0) return { names: ["رنگ"], valuesText: [""], rows: [] };
  const names = variants[0]!.options.map((o) => o.name);
  const valuesText = names.map((_, i) => [...new Set(variants.map((v) => v.options[i]?.value ?? ""))].filter(Boolean).join("، "));
  return { names, valuesText, rows: variants.map((v) => ({ options: v.options, price: String(v.price), stock: String(v.stockQuantity), sku: v.sku ?? "" })) };
}
