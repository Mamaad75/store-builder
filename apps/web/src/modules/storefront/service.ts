import { NotFoundError } from "@/modules/stores/errors";
import { findLatestActiveThemeVersion, themeVersionDefaults } from "@/modules/stores/repository";
import { resolveThemeDefinition } from "@/templates/theme-catalog";
import { parseStoreId } from "@/modules/stores/service";
import { buildStorefrontData, type StorefrontNotes } from "./build";
import { DraftStorefrontRepository } from "./repository";
import type { StorefrontData } from "@/templates/storefront-data";

export interface DraftPreview {
  data: StorefrontData;
  notes: StorefrontNotes;
  /** Set when the preview shows a CANDIDATE theme instead of the store's own (nothing is applied or stored). */
  candidate: { key: string; name: string } | null;
}

/** The requested candidate theme is unknown, inactive or not registered in the code. */
export class CandidateThemeUnavailableError extends Error {
  constructor() {
    super("Candidate theme is not available");
    this.name = "CandidateThemeUnavailableError";
  }
}

/**
 * Owner-only draft preview data. `ownerId` must come from the server session. Missing and foreign
 * stores are indistinguishable (NotFoundError). Read-only: no write, no revision bump, no publish.
 */
export async function getDraftPreview(ownerId: string, storeId: unknown, opts: { candidateThemeKey?: string } = {}): Promise<DraftPreview> {
  const id = parseStoreId(storeId);
  const repo = new DraftStorefrontRepository(ownerId);
  const source = await repo.load(id);
  if (!source) throw new NotFoundError();
  if (opts.candidateThemeKey === undefined) return { ...buildStorefrontData(source), candidate: null };

  // Candidate theme: the same draft data rendered with the latest ACTIVE version of another theme. Read-only - the
  // store's own theme pointer, its pages and everything published are untouched; nothing is persisted.
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(opts.candidateThemeKey)) throw new CandidateThemeUnavailableError();
  const row = await findLatestActiveThemeVersion(opts.candidateThemeKey);
  const def = row ? resolveThemeDefinition(row.template.key, row.version) : null;
  if (!row || !def) throw new CandidateThemeUnavailableError();
  const withCandidate = { ...source, template: { key: def.key, version: def.version, defaultSettings: await themeVersionDefaults(row.id) } };
  return { ...buildStorefrontData(withCandidate), candidate: { key: def.key, name: def.meta.name } };
}
