import { computeCompatibility, type CompatibilityResult } from "@/modules/pages/compat";
import { PAGE_TYPES } from "@/templates/sections";
import type { PageType } from "@/templates/sections";
import { allThemes, resolveThemeDefinition } from "@/templates/theme-catalog";
import type { ThemeDefinition } from "@/templates/theme";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { withStoreMutation } from "./mutation";
import { findLatestActiveThemeVersion, setTemplateVersionInTx, StoreRepository, themeContextInTx } from "./repository";
import { switchThemeSchema } from "./schemas";
import { parseStoreId } from "./service";

/**
 * Draft theme switching (phase 9B).
 *
 *  - A switch changes ONE column: `Store.templateVersionId` (and bumps `draftRevision`, because the draft renders
 *    differently). No page, section, product, category, media, setting, snapshot or published pointer is written:
 *    the active/dormant/invalid state of a section is derived from the stored JSON and the ACTIVE theme on every read,
 *    so "becoming dormant" and "reappearing" need no data change at all.
 *  - It is refused (with the full report) when it would introduce a NEW invalid section or leave a page without a
 *    section type the target requires. Pre-existing invalid data never blocks it. Nothing is repaired automatically:
 *    the owner fixes the page under the current theme first.
 *  - Only the LATEST ACTIVE version of a theme key is a valid target (upgrades are out of scope).
 *  - The report carries the draft revision it was computed from; any edit since then makes the switch a ConflictError.
 */

/** The switch would introduce a new invalid section / violate a required-section rule. Carries the report. */
export class ThemeSwitchBlockedError extends Error {
  constructor(public readonly result: CompatibilityResult) {
    super("Theme switch blocked by compatibility problems");
    this.name = "ThemeSwitchBlockedError";
  }
}

export interface ThemeRef {
  key: string;
  version: number;
  name: string;
  description: string;
}

export interface ThemeSwitchReport extends CompatibilityResult {
  storeId: string;
  /** The draft revision this report was computed from; pass it to `switchTheme`. */
  draftRevision: number;
  current: ThemeRef;
  target: ThemeRef;
  /** True when the target is the theme the store already uses (nothing to do). */
  sameTheme: boolean;
}

const ref = (d: ThemeDefinition): ThemeRef => ({ key: d.key, version: d.version, name: d.meta.name, description: d.meta.description });

/** Resolves a target theme key to the definition of its latest active version that exists in the DB AND in the code. */
async function resolveTarget(client: Parameters<typeof findLatestActiveThemeVersion>[1], key: string): Promise<{ versionId: string; definition: ThemeDefinition }> {
  const row = await findLatestActiveThemeVersion(key, client);
  const definition = row ? resolveThemeDefinition(row.template.key, row.version) : null;
  if (!row || !definition) throw new ValidationError({ targetKey: ["این قالب در دسترس نیست"] });
  return { versionId: row.id, definition };
}

function currentOf(ctx: { templateVersion: { id: string; version: number; template: { key: string } } }): ThemeDefinition | null {
  return resolveThemeDefinition(ctx.templateVersion.template.key, ctx.templateVersion.version);
}

const PAGE_SET = new Set<string>(PAGE_TYPES);
const toInputs = (pages: { type: string; title: string; isVisible: boolean; sections: unknown }[]) =>
  pages.filter((p) => PAGE_SET.has(p.type)).map((p) => ({ type: p.type as PageType, title: p.title, isVisible: p.isVisible, sections: p.sections }));

/** Themes the owner may switch to: registered in the code AND having an active version in the DB (the latest one). */
export async function listSwitchableThemes(ownerId: string, storeId: unknown): Promise<{ current: ThemeRef | null; themes: ThemeRef[] }> {
  const id = parseStoreId(storeId);
  const ctx = await new StoreRepository(ownerId).themeContext(id);
  if (!ctx) throw new NotFoundError();
  const current = currentOf(ctx);
  const themes: ThemeRef[] = [];
  for (const key of new Set(allThemes().map((t) => t.key))) {
    const row = await findLatestActiveThemeVersion(key);
    const def = row ? resolveThemeDefinition(row.template.key, row.version) : null;
    if (def) themes.push(ref(def));
  }
  return { current: current ? ref(current) : null, themes };
}

/** Read-only. Describes exactly what a switch to `targetKey` would do; writes nothing. */
export async function previewThemeSwitch(ownerId: string, storeId: unknown, targetKey: unknown): Promise<ThemeSwitchReport> {
  const id = parseStoreId(storeId);
  const parsed = switchThemeSchema.pick({ targetKey: true }).safeParse({ targetKey });
  if (!parsed.success) throw new ValidationError({ targetKey: ["قالب نامعتبر است"] });
  const ctx = await new StoreRepository(ownerId).themeContext(id);
  if (!ctx) throw new NotFoundError();
  const from = currentOf(ctx);
  if (!from) throw new ValidationError({ targetKey: ["قالب فعلی فروشگاه پشتیبانی نمی‌شود"] });
  const { definition: to } = await resolveTarget(undefined, parsed.data.targetKey);
  const sameTheme = ctx.templateVersion.template.key === to.key;
  const result = computeCompatibility(toInputs(ctx.pages), from, sameTheme ? from : to);
  return { ...result, storeId: id, draftRevision: ctx.draftRevision, current: ref(from), target: ref(to), sameTheme };
}

export async function switchTheme(ownerId: string, storeId: unknown, input: unknown): Promise<{ changed: boolean; theme: ThemeRef }> {
  const id = parseStoreId(storeId);
  const parsed = switchThemeSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const { targetKey, expectedDraftRevision } = parsed.data;

  class Unchanged extends Error {}
  try {
    return await withStoreMutation(ownerId, id, async (m) => {
      // withStoreMutation has already bumped the revision under the store lock: the report's revision is exactly one behind.
      const ctx = await themeContextInTx(m);
      if (!ctx) throw new NotFoundError();
      if (ctx.draftRevision !== expectedDraftRevision + 1) throw new ConflictError(); // the draft changed after the report was made
      const from = currentOf(ctx);
      if (!from) throw new ValidationError({ targetKey: ["قالب فعلی فروشگاه پشتیبانی نمی‌شود"] });
      const target = await resolveTarget(m.tx, targetKey);
      if (ctx.templateVersion.template.key === target.definition.key) throw new Unchanged(); // same theme: nothing to write
      const result = computeCompatibility(toInputs(ctx.pages), from, target.definition);
      if (!result.canSwitch) throw new ThemeSwitchBlockedError(result); // re-evaluated under the lock: never trusts the earlier report
      if (!(await setTemplateVersionInTx(m, ctx.templateVersion.id, target.versionId))) throw new ConflictError();
      return { changed: true, theme: ref(target.definition) };
    });
  } catch (e) {
    if (e instanceof Unchanged) {
      // The transaction rolled back, so the revision was not bumped.
      const ctx = await new StoreRepository(ownerId).themeContext(id);
      const cur = ctx ? currentOf(ctx) : null;
      if (!cur) throw new NotFoundError();
      return { changed: false, theme: ref(cur) };
    }
    throw e;
  }
}
