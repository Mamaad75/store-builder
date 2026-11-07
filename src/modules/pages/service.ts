import { randomBytes } from "node:crypto";
import { z } from "zod";
import { releaseMedia } from "@/modules/media/service";
import { findMediaInTx } from "@/modules/media/repository";
import { ConflictError, NotFoundError, ValidationError } from "@/modules/stores/errors";
import { withStoreMutation, type MutationContext } from "@/modules/stores/mutation";
import { parseStoreId } from "@/modules/stores/service";
import { defaultSectionProps } from "@/templates/section-defaults";
import { IMAGE_SECTION_TYPES } from "@/templates/section-fields";
import { MAX_SECTIONS_PER_PAGE, NON_HIDEABLE_PAGES, type PageEditorRules } from "@/templates/editor";
import { PAGE_TYPES, SECTION_TYPES, sectionPropsSchemas, type PageType, type Section, type SectionType } from "@/templates/sections";
import { resolveTemplate } from "@/templates/registry";
import { analyzePage, sectionsEqual, type InvalidEntry } from "./analyze";
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
const sectionTypeSchema = z.enum(SECTION_TYPES);
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

export interface PageEditorView extends PageSummary {
  storeId: string;
  sections: Section[];
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
  const tpl = resolveTemplate(t.templateVersion.template.key, t.templateVersion.version);
  return tpl ? tpl.editor : null;
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
      const a = spec ? analyzePage(r.sections, spec.pages[r.type]) : { sections: [], invalid: [] as InvalidEntry[] };
      const count = Array.isArray(r.sections) ? r.sections.length : 0;
      return {
        type: r.type,
        title: r.title,
        slug: r.slug,
        isVisible: r.isVisible,
        canHide: !NON_HIDEABLE_PAGES.includes(r.type),
        revision: r.revision,
        sectionCount: spec ? a.sections.length : count,
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
  const imageIds = a.sections.flatMap((s) => ("imageId" in s.props && s.props.imageId ? [s.props.imageId] : []));
  const media = await repo.readyMedia(sid, imageIds);
  return {
    storeId: sid,
    type,
    title: row.title,
    slug: row.slug,
    isVisible: row.isVisible,
    canHide: !NON_HIDEABLE_PAGES.includes(type),
    revision: row.revision,
    sectionCount: a.sections.length,
    invalidCount: a.invalid.length,
    archivedCount: archivedCount(row),
    sections: a.sections,
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

type Edit = (env: { ctx: MutationContext; page: PageRow; rules: PageEditorRules; sections: Section[]; invalid: InvalidEntry[] }) => Promise<{
  sections?: Section[];
  isVisible?: boolean;
  legacySections?: unknown[];
  /** Media ids that were referenced before and may be unreferenced now. */
  release?: string[];
  recovery?: boolean;
}>;

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
      const tpl = t ? resolveTemplate(t.templateVersion.template.key, t.templateVersion.version) : null;
      if (!tpl) throw new UnsupportedTemplateError();
      if (page.revision !== expected) throw new ConflictError(); // someone else changed this page since the form was loaded
      const rules = tpl.editor.pages[type];
      const a = analyzePage(page.sections, rules);
      const out = await edit({ ctx, page, rules, sections: a.sections, invalid: a.invalid });
      if (a.invalid.length > 0 && !out.recovery) throw new PageNeedsRecoveryError(a.invalid.length);
      const nextSections = out.sections ?? (out.recovery ? a.sections : undefined);
      const data: Parameters<typeof writePage>[2] = {};
      if (nextSections !== undefined && !sectionsEqual(nextSections, page.sections)) data.sections = nextSections as never;
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
  // Images that no longer have a reference are released (reference-aware; never throws for storage problems).
  for (const id of release) await releaseMedia(ownerId, sid, id).catch(() => undefined);
  return result;
}

export async function addSection(ownerId: string, storeId: unknown, pageType: unknown, input: { type: unknown }, expectedRevision: unknown): Promise<EditResult> {
  const t = sectionTypeSchema.safeParse(input.type);
  if (!t.success) throw new ValidationError({ type: ["نوع بخش نامعتبر است"] });
  const type: SectionType = t.data;
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ rules, sections }) => {
    if (!rules.allowed.includes(type)) throw new ValidationError({ type: ["این بخش برای این صفحه مجاز نیست"] });
    if (sections.length >= MAX_SECTIONS_PER_PAGE) throw new SectionLimitError(MAX_SECTIONS_PER_PAGE);
    if (rules.singletons.includes(type) && sections.some((s) => s.type === type)) throw new ValidationError({ type: ["این بخش فقط یک‌بار در صفحه مجاز است"] });
    let id = newSectionId();
    while (sections.some((s) => s.id === id)) id = newSectionId();
    const section = { id, type, props: defaultSectionProps(type) } as Section;
    return { sections: [...sections, section] };
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
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ sections }) => {
    const current = sections.find((s) => s.id === sid.data);
    if (!current) throw new NotFoundError();
    if (typeof props !== "object" || props === null || Array.isArray(props)) throw new ValidationError({ _form: ["اطلاعات بخش نامعتبر است"] });
    // The type comes from the stored section (never from the client); hidden fields such as imageId are preserved.
    const parsed = sectionPropsSchemas[current.type].safeParse({ ...current.props, ...(props as Record<string, unknown>) });
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const next = { ...current, props: parsed.data } as Section;
    return { sections: sections.map((s) => (s.id === current.id ? next : s)) };
  });
}

export async function removeSection(ownerId: string, storeId: unknown, pageType: unknown, sectionId: unknown, expectedRevision: unknown): Promise<EditResult> {
  const sid = sectionIdSchema.safeParse(sectionId);
  if (!sid.success) throw new NotFoundError();
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ rules, sections }) => {
    const current = sections.find((s) => s.id === sid.data);
    if (!current) throw new NotFoundError();
    // A section the page cannot work without (e.g. the product grid) is never removed.
    if (rules.required.includes(current.type) && sections.filter((s) => s.type === current.type).length === 1) {
      throw new ValidationError({ sections: ["این بخش برای عملکرد صفحه لازم است و حذف نمی‌شود"] });
    }
    const imageId = "imageId" in current.props ? current.props.imageId : null;
    return { sections: sections.filter((s) => s.id !== current.id), release: imageId ? [imageId] : [] };
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
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ sections }) => {
    const i = sections.findIndex((s) => s.id === sid.data);
    if (i === -1) throw new NotFoundError();
    const j = dir.data === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= sections.length) return { sections }; // already at the edge: a no-op
    const next = [...sections];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return { sections: next };
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
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ ctx, sections }) => {
    const current = sections.find((s) => s.id === sid.data);
    if (!current) throw new NotFoundError();
    if (!IMAGE_SECTION_TYPES.includes(current.type) || !("imageId" in current.props)) throw new ValidationError({ imageId: ["این بخش تصویر ندارد"] });
    if (mediaId !== null) {
      const media = await findMediaInTx(ctx, mediaId);
      // Missing, other store's, PENDING and DELETING media are indistinguishable.
      if (!media || media.status !== "READY") throw new NotFoundError();
    }
    const previous = current.props.imageId;
    const next = { ...current, props: { ...current.props, imageId: mediaId } } as Section;
    return { sections: sections.map((s) => (s.id === current.id ? next : s)), release: previous && previous !== mediaId ? [previous] : [] };
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
 * Explicit recovery for a page with invalid/unknown section data: the offending entries are MOVED (verbatim, with
 * their position and reason) to `legacySections`, the editable list keeps the valid ones. Nothing is deleted.
 */
export async function recoverPage(ownerId: string, storeId: unknown, pageType: unknown, expectedRevision: unknown): Promise<EditResult> {
  return mutatePage(ownerId, storeId, pageType, expectedRevision, async ({ page, rules, sections, invalid }) => {
    if (invalid.length === 0) return { recovery: true };
    const archivedAt = new Date().toISOString();
    const previous = Array.isArray(page.legacySections) ? page.legacySections : [];
    // The page must stay functional: a required section that only existed in invalid form is re-created with defaults.
    const kept = [...sections];
    for (const t of rules.required) {
      if (!kept.some((s) => s.type === t)) kept.push({ id: newSectionId(), type: t, props: defaultSectionProps(t) } as Section);
    }
    return {
      recovery: true,
      sections: kept,
      legacySections: [...previous, ...invalid.map((i) => ({ archivedAt, index: i.index, reason: i.reason, raw: i.raw ?? null }))],
    };
  });
}
