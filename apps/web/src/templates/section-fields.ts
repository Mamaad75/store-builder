import { parseIntegerInput } from "@/lib/money";
import { normalizeFaText } from "@/lib/text";
import type { SectionType } from "./sections";

export type FieldKind = "text" | "textarea" | "link" | "number";

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  max?: number;
  min?: number;
  help?: string;
}

/** Internal destinations offered by the link fields (the schema accepts any internal path; the UI offers the known ones). */
export const LINK_TARGETS = [
  { path: "/", label: "صفحه اصلی" },
  { path: "/products", label: "محصولات" },
  { path: "/about", label: "درباره ما" },
  { path: "/contact", label: "تماس با ما" },
] as const;

/**
 * The editable fields of each section type. Only these names are ever read from a submitted form (whitelist), and the
 * result is validated again by the strict per-type props schema. Image fields (`imageId`) are not form fields: they
 * change only through the media upload actions, which validate the reference against the current store.
 */
export const SECTION_FIELDS: Record<SectionType, FieldSpec[]> = {
  hero: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "subtitle", label: "زیرعنوان", kind: "textarea", max: 300 },
    { name: "buttonText", label: "متن دکمه", kind: "text", max: 40, help: "خالی بگذارید تا دکمه نمایش داده نشود." },
    { name: "buttonLink", label: "مقصد دکمه", kind: "link" },
  ],
  featuredProducts: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "limit", label: "تعداد محصول", kind: "number", min: 1, max: 12 },
  ],
  productGrid: [{ name: "title", label: "عنوان", kind: "text", max: 120 }],
  categoryFilter: [],
  productDetail: [],
  richText: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "body", label: "متن", kind: "textarea", max: 5000 },
  ],
  imageText: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "body", label: "متن", kind: "textarea", max: 3000 },
  ],
  contactInfo: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "body", label: "متن", kind: "textarea", max: 1000 },
  ],
  callToAction: [
    { name: "title", label: "عنوان", kind: "text", max: 120 },
    { name: "buttonText", label: "متن دکمه", kind: "text", max: 40 },
    { name: "buttonLink", label: "مقصد دکمه", kind: "link" },
  ],
};

/** Image-capable section types (they carry `imageId`). */
export const IMAGE_SECTION_TYPES: readonly SectionType[] = ["hero", "imageText"];

/** Builds the candidate props from a form: whitelisted fields only, text normalised, numbers parsed. Validation happens later. */
export function propsFromForm(type: SectionType, get: (name: string) => string | null): Record<string, unknown> {
  return propsFromFields(SECTION_FIELDS[type], get);
}

/** Same, for any field list (core or theme-specific section definitions). */
export function propsFromFields(fields: readonly FieldSpec[], get: (name: string) => string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = get(f.name);
    if (raw === null) continue;
    out[f.name] = f.kind === "number" ? parseIntegerInput(raw) : f.kind === "link" ? raw.trim() : normalizeFaText(raw);
  }
  return out;
}
