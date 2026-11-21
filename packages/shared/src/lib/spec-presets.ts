/**
 * Spec presets: OPTIONAL label suggestions for the product form ("add these rows, then fill in the values").
 * They are never validation rules: any label is allowed with or without a preset, and a preset is not tied to a
 * business category (every store can use every preset; a category only decides which ones are listed first).
 */
export interface SpecPreset {
  key: string;
  name: string;
  labels: readonly string[];
}

export const SPEC_PRESETS: readonly SpecPreset[] = [
  { key: "appliance", name: "لوازم خانگی", labels: ["برند", "مدل", "گارانتی", "رنگ", "ظرفیت", "توان مصرفی", "ابعاد", "وزن", "کشور سازنده"] },
  { key: "general", name: "مشخصات عمومی", labels: ["برند", "مدل", "رنگ", "جنس", "ابعاد", "وزن", "کشور سازنده"] },
  { key: "digital", name: "کالای دیجیتال", labels: ["برند", "مدل", "حافظه داخلی", "حافظه رم", "پردازنده", "اندازه صفحه", "باتری", "گارانتی"] },
  { key: "beauty", name: "آرایشی و بهداشتی", labels: ["برند", "حجم", "مناسب برای", "رایحه", "ماندگاری", "کشور سازنده"] },
  { key: "clothing", name: "پوشاک", labels: ["جنس", "سایزبندی", "رنگ", "نوع یقه", "کشور سازنده", "شست‌وشو"] },
  { key: "digital-goods", name: "اشتراک و محصول دیجیتال", labels: ["پلتفرم", "ریجن", "مدت", "نوع تحویل", "زبان"] },
  { key: "food", name: "خوراکی", labels: ["وزن", "ترکیبات", "ماندگاری", "شرایط نگهداری"] },
  { key: "plant", name: "گل و گیاه", labels: ["نوع گیاه", "نور مناسب", "آبیاری", "اندازه گلدان"] },
];

export const getSpecPreset = (key: string): SpecPreset | null => SPEC_PRESETS.find((p) => p.key === key) ?? null;

/** Every preset, always: `suggested` ones first (a hint, not a restriction). */
export function listSpecPresets(suggested: readonly string[] = []): SpecPreset[] {
  const rank = (k: string) => {
    const i = suggested.indexOf(k);
    return i === -1 ? suggested.length : i;
  };
  return [...SPEC_PRESETS].sort((a, b) => rank(a.key) - rank(b.key));
}
