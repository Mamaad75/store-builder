import { analyzeSpecs } from "@/lib/product-specs";
import { STOREFRONT_SCHEMA_VERSION, storefrontDataSchema, type StorefrontData } from "@/templates/storefront-data";
import { parseSections, type SectionIssue } from "@/templates/section-parse";
import { DEFAULT_TYPOGRAPHY, templateSettingsSchema, type TemplateSettings } from "@/templates/sections";
import { resolveThemeDefinition } from "@/templates/theme-catalog";

/** Image columns as stored; only READY images with known dimensions are ever exposed to templates. */
export interface MediaSource {
  key: string;
  width: number | null;
  height: number | null;
  status: string;
}

const toMediaRef = (m: MediaSource | null | undefined) => (m && m.status === "READY" && m.width && m.height ? { key: m.key, width: m.width, height: m.height } : null);

/** Plain rows as the repository hands them over (JSON columns are `unknown`: they are validated here). */
export interface StorefrontSource {
  store: { name: string; settings: unknown; logo?: MediaSource | null };
  template: { key: string; version: number; defaultSettings: unknown };
  pages: { type: string; title: string; slug: string; position: number; sections: unknown }[];
  categories: { id: string; name: string; slug: string }[];
  products: { id: string; name: string; slug: string; description: string; price: number; stockQuantity: number; categoryId: string | null; image?: MediaSource | null; specs?: unknown }[];
  /** READY media of the store that sections may reference, by media id (only ids found here can ever be rendered). */
  images?: Record<string, MediaSource>;
  /** Products that exist but are not storefront-eligible (draft/archived). Only a count: never their data. */
  excludedProductCount: number;
}

/** What the builder had to work around. Surfaced to the owner in the preview; never modifies stored data. */
export interface StorefrontNotes {
  settingsFallback: boolean;
  excludedProductCount: number;
  skippedSections: { pageType: string; issues: SectionIssue[] }[];
  /** Valid sections the store's theme does not approve (kept in the database, not rendered). */
  dormantSectionCount: number;
  /** Products whose STORED specifications are invalid: shown without specs, the stored value is untouched. */
  invalidSpecsProductCount: number;
}

export class StorefrontBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorefrontBuildError";
  }
}

const FALLBACK_SETTINGS: TemplateSettings = {
  typography: DEFAULT_TYPOGRAPHY,
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
  let dormantSectionCount = 0;
  let invalidSpecsProductCount = 0;
  const theme = resolveThemeDefinition(src.template.key, src.template.version);
  const pages = [...src.pages]
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const { sections: parsed, issues } = parseSections(p.sections);
      if (issues.length > 0) skippedSections.push({ pageType: p.type, issues });
      // Only sections the theme approves for the page are part of the storefront data. A valid section of another theme
      // is dormant: it stays in the database untouched, but is never rendered and never reaches a published snapshot.
      const allowed = theme ? theme.editor.pages[p.type as keyof typeof theme.editor.pages]?.allowed : undefined;
      const sections = allowed ? parsed.filter((s) => allowed.includes(s.type)) : parsed;
      dormantSectionCount += parsed.length - sections.length;
      return { type: p.type, title: p.title, slug: p.slug, position: p.position, sections };
    });

  const images: Record<string, ReturnType<typeof toMediaRef>> = {};
  for (const p of pages) {
    for (const sec of p.sections) {
      const raw = (sec.props as Record<string, unknown>).imageId;
      const id = typeof raw === "string" ? raw : null;
      const ref = id ? toMediaRef(src.images?.[id]) : null;
      if (id && ref) images[id] = ref;
    }
  }

  const candidate = {
    schemaVersion: STOREFRONT_SCHEMA_VERSION,
    template: { key: src.template.key, version: src.template.version },
    store: { name: src.store.name, direction: resolved.direction, primaryColor: resolved.primaryColor, contact: resolved.contact, social: resolved.social, logo: toMediaRef(src.store.logo), typography: resolved.typography },
    pages,
    categories: src.categories,
    products: src.products.map(({ image, specs, ...p }) => {
      const a = analyzeSpecs(specs ?? []);
      if (!a.ok) invalidSpecsProductCount += 1; // never rendered, never repaired here
      return { ...p, image: toMediaRef(image), specs: a.ok ? a.rows : [] };
    }),
    images,
  };
  const parsed = storefrontDataSchema.safeParse(candidate);
  if (!parsed.success) throw new StorefrontBuildError("storefront data violates the contract");
  return {
    data: parsed.data,
    notes: { settingsFallback, excludedProductCount: src.excludedProductCount, skippedSections, dormantSectionCount, invalidSpecsProductCount },
  };
}
