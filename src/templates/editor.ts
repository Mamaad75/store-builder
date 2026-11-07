import type { PageType } from "./sections";

/**
 * What the dashboard may do with the sections of one page, declared BY THE TEMPLATE (see `TemplateModule.editor`).
 * The editing service, the forms and the tests only consult this spec, so a new template (Coffee, Fashion) brings its
 * own approved sections by exporting its own spec; nothing in the editing core names a template.
 */
export interface PageEditorRules {
  /** Section types that may exist on this page and be added from the "add section" menu. */
  readonly allowed: readonly string[];
  /** Types that may appear at most once on the page. */
  readonly singletons: readonly string[];
  /** Types of which at least one must remain (e.g. the product grid on the product listing page). */
  readonly required: readonly string[];
}

export interface EditorSpec {
  readonly pages: Readonly<Record<PageType, PageEditorRules>>;
}

/** Hard cap on sections per page, enforced by the service for every template. */
export const MAX_SECTIONS_PER_PAGE = 20;

/** Pages that are part of the storefront's basic structure and can never be hidden. */
export const NON_HIDEABLE_PAGES: readonly PageType[] = ["HOME", "PRODUCTS"];

export const isApprovedSection = (spec: EditorSpec, page: PageType, type: string): boolean => spec.pages[page].allowed.includes(type);
