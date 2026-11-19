import { randomBytes } from "node:crypto";
import { z } from "zod";
import { releaseMediaBestEffort } from "@/modules/media/service";
import { findMediaInTx } from "@/modules/media/repository";
import { ConflictError, NotFoundError, ValidationError } from "@/modules/stores/errors";
import { withStoreMutation, type MutationContext } from "@/modules/stores/mutation";
import { parseStoreId } from "@/modules/stores/service";
import { MAX_SECTIONS_PER_PAGE, NON_HIDEABLE_PAGES, type PageEditorRules } from "@/templates/editor";
import { defaultPropsOf, getSectionDefinition } from "@/templates/section-registry";
import type { PageSection } from "@/templates/section-parse";
import { PAGE_TYPES, type PageType } from "@/templates/sections";
import { resolveThemeDefinition } from "@/templates/theme-catalog";
import { analyzePage, imageIdOf, sectionsEqual, serializeEntries, type Entry, type InvalidEntry } from "./analyze";
import { NoChange, PageNeedsRecoveryError, SectionLimitError, UnsupportedTemplateError } from "./errors";
import { PageRepository, findPageInTx, templateOfInTx, writePage, type PageRow } from "./repository";

/**
 * Draft page editing. Every function takes `ownerId` from the server session as its first argument.
 *
 * Concurrency: all writes run in `withStoreMutation` (ownership in SQL, store row locked, draftRevision bumped) and
 * carry the page revision the form was loaded with. A stale form is an explicit ConflictError, never a silent
 * overwrite. An operation that changes nothing throws NoChange inside the transaction, which rolls the bump back:
 * no-ops change neither draftRevision nor the page revision.
 */

const pageTypeSchema = z.enum(PAGE_TYPES);
const sectionTypeSchema = z.string().min(1).max(80);
const revisionSchema = z.number().int().min(1).max(2_147_483_647);
const sectionIdSchema = z.string().min(1).max(40);

export function parsePageType(raw: unknown): PageType {
  const r = pageTypeSchema.safeParse(raw);
  if (!r.success) throw new NotFoundError(); // an unknown page is "not found", exactly like a foreign one
  return r.data;
}

function parseRevision(raw: unknown): number {
  const r = revisionSchema.safeParse(typeof raw === "string" ? Number(raw) : raw);
  if (!r.success) throw new ValidationError({ _form: ["نسخهٔ صفحه نامعتبر است. صفحه را تازه کنید."] });
  return r.data;
}

export const newSectionId = (): string => `s${randomBytes(6).toString("hex")}`;

// ---------------------------------------------------------------- reads

export interface EditorIssue {
  index: number;
  reason: InvalidEntry["reason"];
  /** Truncated JSON of the stored value, for display only. */
  preview: string;
}

export interface PageSummary {
  type: PageType;
  title: string;
  slug: string;
  isVisible: boolean;
  canHide: boolean;
  revision: number;
  sectionCount: number;
  invalidCount: number;
  archivedCount: number;
}

export interface DormantView {
  id: string;
  type: string;
  label: string;
  /** Truncated JSON of the stored value, for display only. */
  preview: string;
}

export interface PageEditorView extends PageSummary {
  storeId: string;
  /** Active sections (rendered and editable with the store's current theme). */
  sections: PageSection[];
  /** Valid sections the current theme does not approve: kept untouched, not rendered, removable by the owner. */
  dormant: DormantView[];
  issues: EditorIssue[];
  /** Section images by media id (READY media of this store only). */
  images: Record<string, { key: string; width: number; height: number }>;
  rules: PageEditorRules;
  maxSections: number;
}

const preview = (raw: unknown) => {
  let s: string;
  try {
    s = JSON.stringify(raw) ?? String(raw);
  } catch {
    s = "[unserialisable]";
  }
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
};

async function resolveSpec(repo: PageRepository, storeId: string) {
  const t = await repo.templateOf(storeId);
  if (!t) throw new NotFoundError();
  const theme = resolveThemeDefinition(t.templateVersion.template.key, t.templateVersion.version);
  return theme ? theme.editor : null;
}

const archivedCount = (row: PageRow) => (Array.isArray(row.legacySections) ? row.legacySections.length : 0);

/** Pages of a store for the dashboard. `supported: false` when the store's template has no editor registered yet. */
export async function listPages(ownerId: string, storeId: unknown): Promise<{ supported: boolean; pages: PageSummary[] }> {
  const sid = parseStoreId(storeId);
  const repo = new PageRepository(ownerId);
  const spec = await resolveSpec(repo, sid);
  const rows = await repo.list(sid);
  return {
    supported: spec !== null,
    pages: rows.map((r) => {
      const a = spec ? analyzePage(r.sections, spec.pages[r.type]) : { entries: [] as Entry[], sections: [], dormant: [] as Entry[], invalid: [] as InvalidEntry[] };
      const count = Array.isArray(r.sections) ? r.sections.length : 0;
      return {
        type: r.type,
        title: r.title,
        slug: r.slug,
        isVisible: r.isVisible,
        canHide: !NON_HIDEABLE_PAGES.includes(r.type),
        revision: r.revision,
        sectionCount: spec ? a.entries.length : count,
        invalidCount: a.invalid.length,
        archivedCount: archivedCount(r),
      };
    }),
  };
}

export async function getPageEditor(ownerId: string, storeId: unknown, pageType: unknown): Promise<PageEditorView> {
  const sid = parseStoreId(storeId);
  const type = parsePageType(pageType);
  const repo = new PageRepository(ownerId);
  const [spec, row] = await Promise.all([resolveSpec(repo, sid), repo.find(sid, type)]);
  if (!row) throw new NotFoundError();
  if (!spec) throw new UnsupportedTemplateError();
  const rules = spec.pages[type];
  const a = analyzePage(row.sections, rules);
  const imageIds = a.entries.flatMap((e) => {
    const id = imageIdOf(e.section);
    return id ? [id] : [];
  });
  const media = await repo.readyMedia(sid, imageIds);
  return {
    storeId: sid,
    type,
    title: row.title,
    slug: row.slug,
    isVisible: row.isVisible,
    canHide: !NON_HIDEABLE_PAGES.includes(type),
    revision: row.revision,
    sectionCount: a.entries.length,
    invalidCount: a.invalid.length,
    archivedCount: archivedCount(row),
    sections: a.sections,
    dormant: a.dormant.map((d) => ({ id: d.section.id, type: d.section.type, label: getSectionDefinition(d.section.type)?.label ?? d.section.type, preview: preview(d.raw) })),
    issues: a.invalid.map((i) => ({ index: i.index, reason: i.reason, preview: preview(i.raw) })),
    images: Object.fromEntries(media.map((m) => [m.id, { key: m.key, width: m.width ?? 1, height: m.height ?? 1 }])),
    rules,
    maxSections: MAX_SECTIONS_PER_PAGE,
  };
}

// ---------------------------------------------------------------- writes

export interface EditResult {
  changed: boolean;
  revision: number;
}

type Edit = (env: { ctx: MutationContext; page: PageRow; rules: PageEditorRules; entries: Entry[]; invalid: InvalidEntry[] }) => Promise<{
  /** The new FULL list (active and dormant entries); omitted when only visibility changes. */
  entries?: Entry[];
  isVisible?: boolean;
  legacySections?: unknown[];
  /** Media ids that were referenced before and may be unreferenced now. */
  release?: string[];
  recovery?: boolean;
}>;

const activeEntry = (section: PageSection): Entry => ({ kind: "active", section, raw: section });
const activeOf = (entries: readonly Entry[]) => entries.filter((e) => e.kind === "active").map((e) => e.section);

async function mutatePage(ownerId: string, storeId: unknown, pageType: unknown, expectedRevision: unknown, edit: Edit): Promise<EditResult> {
  const sid = parseStoreId(storeId);
  const type = parsePageType(pageType);
  const expected = parseRevision(expectedRevision);
  let release: string[] = [];
  let result: EditResult;
  try {
    result = await withStoreMutation(ownerId, sid, async (ctx) => {
      const page = await findPageInTx(ctx, type);
      if (!page) throw new NotFoundError();
      const t = await templateOfInTx(ctx);
      const theme = t ? resolveThemeDefinition(t.templateVersion.template.key, t.templateVersion.version) : null;
      if (!theme) throw new UnsupportedTemplateError();
      if (page.revision !== expected) throw new ConflictError(); // someone else changed this page since the form was loaded
      const rules = theme.editor.pages[type];
      const a = analyzePage(page.sections, rules);
      const out = await edit({ ctx, page, rules, entries: a.entries, invalid: a.invalid });
      if (a.invalid.length > 0 && !out.recovery) throw new PageNeedsRecoveryError(a.invalid.length);
      const data: Parameters<typeof writePage>[2] = {};
      if (out.entries !== undefined) {
        // Unchanged entries (active AND dormant) are written back exactly as stored; only deliberate changes differ.
        const next = serializeEntries(out.entries);
        if (!sectionsEqual(next, page.sections)) data.sections = next as never;
      }
      if (out.isVisible !== undefined && out.isVisible !== page.isVisible) data.isVisible = out.isVisible;
      if (out.legacySections !== undefined) data.legacySections = out.legacySections as never;
      if (Object.keys(data).length === 0) throw new NoChange();
      if (!(await writePage(ctx, page, data))) throw new ConflictError();
      release = out.release ?? [];
      return { changed: true, revision: page.revision + 1 };
    });
  } catch (e) {
    if (e instanceof NoChange) {
      const row = await new PageRepository(ownerId).find(sid, type);
      if (!row) throw new NotFoundError();
      return { changed: false, revision: row.revision };
    }
    throw e;
  }
  // Images that no longer have a reference are released (reference-aware). The edit has committed: a failure here is logged and
  // never reported as a failed edit; the media cleanup removes the image later.
  for (const id of release) await releaseMediaBestEffort(ownerId, sid, id);
  return result;
}

export async function addSection(ownerId: string, storeId: unknown, pageType: unknown, input: { type: unknown }, expectedRevision: unknown): Promise<EditResult> {
  const t = sectionTypeSchema.safeParse(input.type);
  if (!t.success) throw new ValidationError({ type: ["نوع بخش نامعتبر است"] });
  const type = t.data;
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ rules, entries }) => {
    // Only types the current theme approves for this page can be added (extra types of OTHER themes are refused).
    if (!rules.allowed.includes(type) || !getSectionDefinition(type)) throw new ValidationError({ type: ["این بخش برای این صفحه مجاز نیست"] });
    if (entries.length >= MAX_SECTIONS_PER_PAGE) throw new SectionLimitError(MAX_SECTIONS_PER_PAGE);
    if (rules.singletons.includes(type) && entries.some((e) => e.kind === "active" && e.section.type === type)) {
      throw new ValidationError({ type: ["این بخش فقط یک‌بار در صفحه مجاز است"] });
    }
    let id = newSectionId();
    while (entries.some((e) => e.section.id === id)) id = newSectionId();
    const section = { id, type, props: defaultPropsOf(type) } as PageSection;
    return { entries: [...entries, activeEntry(section)] };
  });
}

export async function updateSection(
  ownerId: string,
  storeId: unknown,
  pageType: unknown,
  sectionId: unknown,
  props: unknown,
  expectedRevision: unknown,
): Promise<EditResult> {
  const sid = sectionIdSchema.safeParse(sectionId);
  if (!sid.success) throw new NotFoundError();
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ entries }) => {
    const current = entries.find((e) => e.kind === "active" && e.section.id === sid.data);
    if (!current) throw new NotFoundError(); // dormant sections are not editable (they are not part of the active theme)
    if (typeof props !== "object" || props === null || Array.isArray(props)) throw new ValidationError({ _form: ["اطلاعات بخش نامعتبر است"] });
    const def = getSectionDefinition(current.section.type);
    if (!def) throw new NotFoundError();
    // The type comes from the stored section (never from the client); hidden fields such as imageId are preserved.
    const parsed = def.schema.safeParse({ ...current.section.props, ...(props as Record<string, unknown>) });
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const next = activeEntry({ ...current.section, props: parsed.data } as PageSection);
    // An update that changes nothing keeps the stored value untouched (so it is a true no-op).
    if (sectionsEqual(next.raw, current.raw)) return { entries };
    return { entries: entries.map((e) => (e === current ? next : e)) };
  });
}

export async function removeSection(ownerId: string, storeId: unknown, pageType: unknown, sectionId: unknown, expectedRevision: unknown): Promise<EditResult> {
  const sid = sectionIdSchema.safeParse(sectionId);
  if (!sid.success) throw new NotFoundError();
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ rules, entries }) => {
    const current = entries.find((e) => e.kind === "active" && e.section.id === sid.data);
    if (!current) throw new NotFoundError();
    // A section the page cannot work without (e.g. the product grid) is never removed.
    if (rules.required.includes(current.section.type) && activeOf(entries).filter((s) => s.type === current.section.type).length === 1) {
      throw new ValidationError({ sections: ["این بخش برای عملکرد صفحه لازم است و حذف نمی‌شود"] });
    }
    const imageId = imageIdOf(current.section);
    return { entries: entries.filter((e) => e !== current), release: imageId ? [imageId] : [] };
  });
}

/**
 * Explicit deletion of a DORMANT section by the owner (the only way a dormant section is ever deleted). Its media
 * reference is released through the normal reference-aware rule (kept while anything else still uses it).
 */
export async function removeDormantSection(ownerId: string, storeId: unknown, pageType: unknown, sectionId: unknown, expectedRevision: unknown): Promise<EditResult> {
  const sid = sectionIdSchema.safeParse(sectionId);
  if (!sid.success) throw new NotFoundError();
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ entries }) => {
    const current = entries.find((e) => e.kind === "dormant" && e.section.id === sid.data);
    if (!current) throw new NotFoundError();
    const imageId = imageIdOf(current.section);
    return { entries: entries.filter((e) => e !== current), release: imageId ? [imageId] : [] };
  });
}

export async function moveSection(
  ownerId: string,
  storeId: unknown,
  pageType: unknown,
  sectionId: unknown,
  direction: unknown,
  expectedRevision: unknown,
): Promise<EditResult> {
  const sid = sectionIdSchema.safeParse(sectionId);
  const dir = z.enum(["up", "down"]).safeParse(direction);
  if (!sid.success) throw new NotFoundError();
  if (!dir.success) throw new ValidationError({ direction: ["جهت نامعتبر است"] });
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ entries }) => {
    // Reordering swaps with the neighbouring ACTIVE section; dormant entries never move (their positions are kept).
    const activeIdx = entries.flatMap((e, i) => (e.kind === "active" ? [i] : []));
    const k = activeIdx.findIndex((i) => entries[i]!.section.id === sid.data);
    if (k === -1) throw new NotFoundError();
    const k2 = dir.data === "up" ? k - 1 : k + 1;
    if (k2 < 0 || k2 >= activeIdx.length) return { entries }; // already at the edge: a no-op
    const next = [...entries];
    const [a, b] = [activeIdx[k]!, activeIdx[k2]!];
    [next[a], next[b]] = [next[b]!, next[a]!];
    return { entries: next };
  });
}

/** Sets or clears the image of a section. The media must be a READY image of THIS store (checked under the store lock). */
export async function setSectionImage(
  ownerId: string,
  storeId: unknown,
  pageType: unknown,
  sectionId: unknown,
  mediaId: string | null,
  expectedRevision: unknown,
): Promise<EditResult> {
  const sid = sectionIdSchema.safeParse(sectionId);
  if (!sid.success) throw new NotFoundError();
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ ctx, entries }) => {
    const current = entries.find((e) => e.kind === "active" && e.section.id === sid.data);
    if (!current) throw new NotFoundError();
    const def = getSectionDefinition(current.section.type);
    if (!def?.image || !("imageId" in current.section.props)) throw new ValidationError({ imageId: ["این بخش تصویر ندارد"] });
    if (mediaId !== null) {
      const media = await findMediaInTx(ctx, mediaId);
      // Missing, other store's, PENDING and DELETING media are indistinguishable.
      if (!media || media.status !== "READY") throw new NotFoundError();
    }
    const previous = imageIdOf(current.section);
    const next = activeEntry({ ...current.section, props: { ...current.section.props, imageId: mediaId } } as PageSection);
    return { entries: entries.map((e) => (e === current ? next : e)), release: previous && previous !== mediaId ? [previous] : [] };
  });
}

export async function setPageVisibility(ownerId: string, storeId: unknown, pageType: unknown, visible: unknown, expectedRevision: unknown): Promise<EditResult> {
  const v = z.boolean().safeParse(visible);
  if (!v.success) throw new ValidationError({ isVisible: ["مقدار نامعتبر است"] });
  const type = parsePageType(pageType);
  if (!v.data && NON_HIDEABLE_PAGES.includes(type)) throw new ValidationError({ isVisible: ["این صفحه را نمی‌توان پنهان کرد"] });
  return mutatePage(ownerId, storeId, type, expectedRevision, async () => ({ isVisible: v.data }));
}

/**
 * Explicit recovery for a page with INVALID (corrupted) section data: the offending entries are MOVED (verbatim, with
 * their position and reason) to `legacySections`; active and dormant entries stay exactly as stored. Nothing is deleted.
 */
export async function recoverPage(ownerId: string, storeId: unknown, pageType: unknown, expectedRevision: unknown): Promise<EditResult> {
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ page, rules, entries, invalid }) => {
    if (invalid.length === 0) return { recovery: true };
    const archivedAt = new Date().toISOString();
    const previous = Array.isArray(page.legacySections) ? page.legacySections : [];
    // The page must stay functional: a required section that only existed in invalid form is re-created with defaults.
    const kept = [...entries];
    for (const t of rules.required) {
      if (!kept.some((e) => e.kind === "active" && e.section.type === t)) {
        kept.push(activeEntry({ id: newSectionId(), type: t, props: defaultPropsOf(t) } as PageSection));
      }
    }
    return {
      recovery: true,
      entries: kept,
      legacySections: [...previous, ...invalid.map((i) => ({ archivedAt, index: i.index, reason: i.reason, raw: i.raw ?? null }))],
    };
  });
}
