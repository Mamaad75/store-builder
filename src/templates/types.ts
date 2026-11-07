import type { ReactElement, ReactNode } from "react";
import type { EditorSpec } from "./editor";
import type { Section, SectionType } from "./sections";
import type { StorefrontData, StorefrontPage, StorefrontProduct } from "./storefront-data";

/** Query parameters a storefront page understands (already parsed and bounded by the engine). */
export interface StorefrontQuery {
  /** Category slug filter for the product listing. */
  category?: string;
  /** 1-based page number of the product listing. */
  page: number;
}

/**
 * Everything a template/section may use while rendering one page. It is built by the engine from
 * validated data; templates never reach for databases, sessions or request objects.
 */
export interface RenderContext {
  data: StorefrontData;
  page: StorefrontPage;
  query: StorefrontQuery;
  /** Product being shown on a PRODUCT_DETAIL page, otherwise null. */
  product: StorefrontProduct | null;
  /** Prefix of every storefront URL (`/preview/<id>` for the draft preview, `` for a public host). */
  basePath: string;
  /** Resolves an internal path (e.g. "/products") against `basePath`. */
  href: (path: string) => string;
  /** Public URL of a stored image key, or null when it cannot be built (templates then show a placeholder). */
  mediaUrl: (key: string) => string | null;
}

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
export interface TemplateModule {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  /** Page chrome: header/navigation, main landmark, footer. */
  readonly Layout: (props: LayoutProps) => ReactElement;
  /** Which sections the dashboard may add/remove/reorder on each page (template-specific, see editor.ts). */
  readonly editor: EditorSpec;
  /** One component per supported section type. */
  readonly sections: { readonly [T in SectionType]?: SectionComponent<T> };
}
