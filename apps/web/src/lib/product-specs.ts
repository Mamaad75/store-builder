import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { normalizeFa } from "./text";

/**
 * Product specifications: an ordered list of `{ label, value }` text rows that belong to the PRODUCT itself (never to a
 * theme or a business category). Pure module: shared by the catalog (write validation), the storefront builder (read
 * validation) and the templates (display helpers).
 *
 *  - WRITE schema (`specsInputSchema`) normalises Persian text and enforces the limits.
 *  - STORED schema (`storedSpecsSchema`) only CHECKS: it never rewrites. Stored JSON that fails it is "invalid"; it is
 *    preserved exactly as stored, reported to the owner and never rendered or silently replaced (see `analyzeSpecs`).
 */
export const MAX_SPEC_ROWS = 30;
export const SPEC_LABEL_MAX = 40;
export const SPEC_VALUE_MAX = 120;
/** Product listing cards show at most this many rows; the detail page shows all of them. */
export const CARD_SPEC_ROWS = 2;

/**
 * Snapshot budget (documented in docs/themes.md). Worst case = 30 rows, each label 40 and value 120 UTF-16 units of
 * 3-byte characters (the most bytes per unit JSON allows without escapes): a row is 23 bytes of JSON structure +
 * 120 + 360 = 503 bytes, 30 rows + 29 commas + 2 brackets = 15,121 bytes per product. 500 products (the store limit)
 * = 7,560,500 bytes (~7.2 MiB). A typical product (about a dozen short Persian rows) is under 1 KiB.
 * A test recomputes these numbers from the real validators, so they cannot drift silently.
 */
export const SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT = 15_121;
export const SPECS_WORST_CASE_JSON_BYTES_PER_STORE = 500 * SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT;

export interface SpecRow {
  label: string;
  value: string;
}

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const noControl = (s: string) => !CONTROL_RE.test(s);

const text = (max: number, what: string) =>
  z
    .string({ error: `${what} نامعتبر است` })
    .transform(normalizeFa)
    .pipe(z.string().min(1, `${what} را وارد کنید`).max(max, `${what} حداکثر ${max.toLocaleString("fa-IR")} کاراکتر است`).refine(noControl, `${what} نامعتبر است`));

const labelKey = (label: string) => label.toLowerCase();

const DUPLICATE_MESSAGE = "نام ویژگی تکراری است";

function uniqueLabels(rows: readonly SpecRow[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const k = labelKey(r.label);
    if (seen.has(k)) ctx.addIssue({ code: "custom", message: DUPLICATE_MESSAGE, path: [i, "label"] });
    seen.add(k);
  });
}

/** Rows written by the owner. Normalised; at most 30 rows; labels unique (case-insensitively). */
export const specsInputSchema = z
  .array(z.object({ label: text(SPEC_LABEL_MAX, "نام ویژگی"), value: text(SPEC_VALUE_MAX, "مقدار ویژگی") }).strict())
  .max(MAX_SPEC_ROWS, `حداکثر ${MAX_SPEC_ROWS.toLocaleString("fa-IR")} ویژگی مجاز است`)
  .superRefine(uniqueLabels);

const storedRow = z
  .object({
    label: z.string().min(1).max(SPEC_LABEL_MAX).refine(noControl),
    value: z.string().min(1).max(SPEC_VALUE_MAX).refine(noControl),
  })
  .strict();

/** Check-only schema for what is already stored (and for the storefront contract). Never transforms. */
export const storedSpecsSchema = z.array(storedRow).max(MAX_SPEC_ROWS).superRefine(uniqueLabels);
/** Row shape used by the storefront contract. */
export const specRowSchema = storedRow;

export type SpecsAnalysis =
  | { ok: true; rows: SpecRow[] }
  | { ok: false; reason: "not_an_array" | "too_many_rows" | "invalid_row" | "duplicate_label"; rowCount: number };

/** Pure. Classifies stored JSON; never modifies it. */
export function analyzeSpecs(raw: unknown): SpecsAnalysis {
  if (!Array.isArray(raw)) return { ok: false, reason: "not_an_array", rowCount: 0 };
  if (raw.length > MAX_SPEC_ROWS) return { ok: false, reason: "too_many_rows", rowCount: raw.length };
  const r = storedSpecsSchema.safeParse(raw);
  if (r.success) return { ok: true, rows: r.data };
  const dup = r.error.issues.some((i) => i.message === DUPLICATE_MESSAGE);
  return { ok: false, reason: dup ? "duplicate_label" : "invalid_row", rowCount: raw.length };
}

export const SPEC_PROBLEM_FA: Record<Exclude<SpecsAnalysis, { ok: true }>["reason"], string> = {
  not_an_array: "ساختار مشخصات ذخیره‌شده معتبر نیست",
  too_many_rows: "تعداد ویژگی‌ها از حد مجاز بیشتر است",
  invalid_row: "برخی ویژگی‌های ذخیره‌شده معتبر نیستند",
  duplicate_label: "نام برخی ویژگی‌ها تکراری است",
};

/** True when `next` (normalised owner input) is exactly what is already stored as VALID specs: nothing to write. */
export const specsUnchanged = (stored: unknown, next: readonly SpecRow[]): boolean => {
  const a = analyzeSpecs(stored);
  return a.ok && isDeepStrictEqual(a.rows, [...next]);
};

/** Display helpers for templates: invalid or empty specs yield nothing, so no empty block is ever rendered. */
export const detailSpecs = (specs: readonly SpecRow[] | undefined): readonly SpecRow[] => specs ?? [];
export const cardSpecs = (specs: readonly SpecRow[] | undefined): readonly SpecRow[] => (specs ?? []).slice(0, CARD_SPEC_ROWS);

/** Display-only truncated JSON of stored value (for the "invalid specifications" notice). */
export function previewStoredSpecs(raw: unknown, max = 600): string {
  let s: string;
  try {
    s = JSON.stringify(raw) ?? String(raw);
  } catch {
    s = "[unserialisable]";
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
