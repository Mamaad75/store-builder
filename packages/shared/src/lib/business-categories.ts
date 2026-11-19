/**
 * Business categories: WHAT a merchant sells. A category is only a label plus starter content and theme suggestions.
 * It is independent of the visual theme (any category can use any theme) and the renderer never reads it.
 *
 * The database stores the key and validates only its FORMAT; this registry is the allowlist, so adding a category
 * needs no migration. Keys are stable identifiers.
 */
export const BUSINESS_CATEGORY_KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;

export interface StarterCopy {
  heroTitle: string;
  heroSubtitle: string;
  cta: string;
  aboutTitle: string;
  aboutBody: string;
}

export interface BusinessCategory {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** Themes to pre-select, best first. Only a suggestion: every theme can be used with every category. */
  readonly suggestedThemes: readonly string[];
  /** Spec presets to list first in the product form. Only a hint: every preset is available to every store. */
  readonly suggestedSpecPresets: readonly string[];
  /** Text used ONCE, when a store is created (never re-applied when the category is changed later). */
  readonly starter: StarterCopy;
}

export const BUSINESS_CATEGORIES: readonly BusinessCategory[] = [
  {
    key: "general",
    name: "عمومی",
    description: "فروشگاهی با محصولات متنوع.",
    suggestedThemes: ["general"],
    suggestedSpecPresets: ["general"],
    starter: {
      heroTitle: "به فروشگاه ما خوش آمدید",
      heroSubtitle: "محصولات متنوع با کیفیت مطمئن",
      cta: "مشاهده محصولات",
      aboutTitle: "درباره ما",
      aboutBody: "فروشگاه ما با هدف ارائه بهترین محصولات راه‌اندازی شده است. این متن را از بخش ویرایش تغییر دهید.",
    },
  },
  {
    key: "coffee-food",
    name: "قهوه و مواد غذایی",
    description: "قهوه، چای، شیرینی و مواد غذایی.",
    suggestedThemes: ["coffee", "general"],
    suggestedSpecPresets: ["general"],
    starter: {
      heroTitle: "قهوه تازه، هر روز",
      heroSubtitle: "دانه‌های برشته‌شده و محصولات خوش‌طعم برای شروع بهتر روز شما",
      cta: "مشاهده محصولات",
      aboutTitle: "داستان ما",
      aboutBody: "ما با عشق قهوه و مواد غذایی باکیفیت تهیه و عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید.",
    },
  },
  {
    key: "fashion",
    name: "پوشاک",
    description: "لباس، کیف، کفش و اکسسوری.",
    suggestedThemes: ["fashion", "general"],
    suggestedSpecPresets: ["general"],
    starter: {
      heroTitle: "استایل خودتان را پیدا کنید",
      heroSubtitle: "جدیدترین مدل‌های پوشاک با کیفیت و قیمت مناسب",
      cta: "خرید کنید",
      aboutTitle: "درباره برند ما",
      aboutBody: "برند ما پوشاک راحت و شیک را برای هر سلیقه‌ای ارائه می‌دهد. این متن را از بخش ویرایش تغییر دهید.",
    },
  },
  {
    key: "home-appliances",
    name: "لوازم خانگی",
    description: "لوازم برقی و وسایل کاربردی منزل.",
    suggestedThemes: ["appliances", "general"],
    suggestedSpecPresets: ["appliance", "general"],
    starter: {
      heroTitle: "لوازم خانگی مطمئن برای خانهٔ شما",
      heroSubtitle: "کالاهای اصل با گارانتی و مشخصات روشن",
      cta: "مشاهده محصولات",
      aboutTitle: "درباره فروشگاه",
      aboutBody: "ما لوازم خانگی معتبر را با راهنمایی روشن و پشتیبانی عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید.",
    },
  },
];

const byKey = new Map(BUSINESS_CATEGORIES.map((c) => [c.key, c]));

export const getBusinessCategory = (key: string): BusinessCategory | null => byKey.get(key) ?? null;
export const isKnownBusinessCategory = (key: string): boolean => byKey.has(key);
export const businessCategoryLabel = (key: string): string => byKey.get(key)?.name ?? key;

/** Best-effort starting category for a theme key (used by the migration backfill and by callers that pass no category). */
export function inferCategoryFromThemeKey(themeKey: string): string {
  return themeKey === "coffee" ? "coffee-food" : themeKey === "fashion" ? "fashion" : themeKey === "appliances" ? "home-appliances" : "general";
}
