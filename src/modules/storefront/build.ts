import { STOREFRONT_SCHEMA_VERSION, storefrontDataSchema, type StorefrontData } from "@/templates/storefront-data";
import { parseSections, templateSettingsSchema, type SectionIssue, type TemplateSettings } from "@/templates/sections";

/** Plain rows as the repository hands them over (JSON columns are `unknown`: they are validated here). */
export interface StorefrontSource {
  store: { name: string; settings: unknown };
  template: { key: string; version: number; defaultSettings: unknown };
  pages: { type: string; title: string; slug: string; position: number; sections: unknown }[];
  categories: { id: string; name: string; slug: string }[];
  products: { id: string; name: string; slug: string; description: string; price: number; stockQuantity: number; categoryId: string | null }[];
  /** Products that exist but are not storefront-eligible (draft/archived). Only a count: never their data. */
  excludedProductCount: number;
}

/** What the builder had to work around. Surfaced to the owner in the preview; never modifies stored data. */
export interface StorefrontNotes {
  settingsFallback: boolean;
  excludedProductCount: number;
  skippedSections: { pageType: string; issues: SectionIssue[] }[];
}

export class StorefrontBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorefrontBuildError";
  }
}

const FALLBACK_SETTINGS: TemplateSettings = {
  primaryColor: "#4f46e5",
  direction: "rtl",
  contact: { phone: "", email: "", address: "" },
  social: { instagram: "", telegram: "", whatsapp: "" },
};

/**
 * Pure: turns persisted rows into the validated `StorefrontData` contract.
 *  - persisted JSON (settings, page sections) is validated here; invalid sections are skipped and reported,
 *    never rendered and never deleted from the database
 *  - invalid settings fall back to the template defaults (reported)
 *  - the result is finally parsed by `storefrontDataSchema`, the same schema the renderer uses
 * Throws StorefrontBuildError only when the result still violates the contract.
 */
export function buildStorefrontData(src: StorefrontSource): { data: StorefrontData; notes: StorefrontNotes } {
  let settingsFallback = false;
  let settings = templateSettingsSchema.safeParse(src.store.settings);
  if (!settings.success) {
    settingsFallback = true;
    settings = templateSettingsSchema.safeParse(src.template.defaultSettings);
  }
  const resolved = settings.success ? settings.data : FALLBACK_SETTINGS;

  const skippedSections: StorefrontNotes["skippedSections"] = [];
  const pages = [...src.pages]
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const { sections, issues } = parseSections(p.sections);
      if (issues.length > 0) skippedSections.push({ pageType: p.type, issues });
      return { type: p.type, title: p.title, slug: p.slug, position: p.position, sections };
    });

  const candidate = {
    schemaVersion: STOREFRONT_SCHEMA_VERSION,
    template: { key: src.template.key, version: src.template.version },
    store: { name: src.store.name, direction: resolved.direction, primaryColor: resolved.primaryColor, contact: resolved.contact, social: resolved.social },
    pages,
    categories: src.categories,
    products: src.products,
  };
  const parsed = storefrontDataSchema.safeParse(candidate);
  if (!parsed.success) throw new StorefrontBuildError("storefront data violates the contract");
  return {
    data: parsed.data,
    notes: { settingsFallback, excludedProductCount: src.excludedProductCount, skippedSections },
  };
}
