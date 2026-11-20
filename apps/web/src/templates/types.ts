import type { ReactElement, ReactNode } from "react";
import type { EditorSpec } from "@store-builder/shared/templates/editor";
import type { ExtraSection } from "@store-builder/shared/templates/section-parse";
import type { Section, SectionType } from "@store-builder/shared/templates/sections";
import type { ThemeDefinition } from "@store-builder/shared/templates/theme";

import type { RenderContext } from "@store-builder/shared/templates/context-types";
export type { RenderContext, StorefrontQuery } from "@store-builder/shared/templates/context-types";

export interface SectionComponentProps<T extends SectionType> {
  section: Extract<Section, { type: T }>;
  ctx: RenderContext;
}

export type SectionComponent<T extends SectionType> = (props: SectionComponentProps<T>) => ReactElement | null;

export interface LayoutProps {
  ctx: RenderContext;
  children: ReactNode;
}

/**
 * The rendering contract every template implements. A template is identified by (key, version);
 * the supported section types are exactly the keys of `sections`. Templates are plain React with no
 * dashboard (MUI) dependency and no data access.
 */
export interface ExtraSectionComponentProps {
  section: ExtraSection;
  ctx: RenderContext;
}
export type ExtraSectionComponent = (props: ExtraSectionComponentProps) => ReactElement | null;

export interface TemplateModule {
  /** The pure half (identity, metadata, extra section definitions, editor spec): see theme.ts. */
  readonly definition: ThemeDefinition;
  readonly key: string;
  readonly version: number;
  readonly name: string;
  /** Page chrome: header/navigation, main landmark, footer. */
  readonly Layout: (props: LayoutProps) => ReactElement;
  /** Which sections the dashboard may add/remove/reorder on each page (template-specific, see editor.ts). */
  readonly editor: EditorSpec;
  /** EVERY core section type must be implemented, so content stays portable between themes. */
  readonly sections: { readonly [T in SectionType]: SectionComponent<T> };
  /** Components for the theme-specific section types declared in `definition.sectionDefinitions`. */
  readonly extraSections: { readonly [type: string]: ExtraSectionComponent };
}
