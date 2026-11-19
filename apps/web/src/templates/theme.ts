import type { z } from "zod";
import type { EditorSpec } from "./editor";
import type { FieldSpec } from "./section-fields";

/**
 * A section type: its strict props schema, defaults and form fields. Core types are defined in the core; a theme may
 * contribute extra types whose key is namespaced by the THEME (`coffee.openingHours`), never by a business category.
 * Definitions are pure data (no React), so server code and scripts can validate sections without loading any theme UI.
 */
export interface SectionDefinition {
  readonly type: string;
  readonly label: string;
  readonly schema: z.ZodType<Record<string, unknown>>;
  readonly defaults: Record<string, unknown>;
  readonly fields: readonly FieldSpec[];
  /** True when the props carry an `imageId` (changed only through the media upload actions). */
  readonly image: boolean;
}

export interface ThemeMeta {
  /** Persian display name of the visual direction (not a business category). */
  readonly name: string;
  readonly description: string;
}

/**
 * The pure half of a theme (everything except React): identity, display metadata, the extra sections it brings and
 * the editor spec that says which sections are ACTIVE on each page. `TemplateModule` adds the components.
 * A published (key, version) is immutable; a redesign is a new version.
 */
export interface ThemeDefinition {
  readonly key: string;
  readonly version: number;
  readonly meta: ThemeMeta;
  readonly sectionDefinitions: readonly SectionDefinition[];
  readonly editor: EditorSpec;
}

/** Namespaced key of a theme-specific section type: `<themeKey>.<name>`. */
export const EXTRA_SECTION_TYPE_RE = /^[a-z][a-z0-9-]{0,39}\.[a-zA-Z][a-zA-Z0-9]{0,39}$/;
