import { storefrontDataSchema, type StorefrontData } from "../storefront-data";
import { resolveTemplate } from "../registry";
import type { RenderContext, TemplateModule } from "../types";
import { makeHref } from "./links";
import { resolveStorefrontRoute } from "./route";

export type StorefrontView =
  | { status: "ok"; template: TemplateModule; ctx: RenderContext }
  | { status: "not_found" }
  | { status: "unsupported_template"; key: string; version: number }
  | { status: "invalid_data" };

export interface ViewRequest {
  basePath: string;
  segments: string[];
  searchParams?: Record<string, string | string[] | undefined>;
  /** Builds public image URLs; omitted => images render as placeholders. */
  mediaUrl?: (key: string) => string | null;
  /** Query string carried on every internal link (candidate-theme preview). Must already be validated by the caller. */
  carryQuery?: string;
}

/**
 * The single entry from "some JSON-ish data" to "something renderable". It never throws:
 *  - the data is validated against the strict schema (persisted JSON is not trusted by type alone)
 *  - the template is chosen from the data's own (key, version), never hardcoded
 *  - unknown templates/versions and malformed data become explicit, safe outcomes
 */
export function buildView(raw: unknown, req: ViewRequest): StorefrontView {
  const parsed = storefrontDataSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid_data" };
  const data: StorefrontData = parsed.data;
  const template = resolveTemplate(data.template.key, data.template.version);
  if (!template) return { status: "unsupported_template", key: data.template.key, version: data.template.version };
  const route = resolveStorefrontRoute(data, req.segments, req.searchParams);
  if (route.kind === "not_found") return { status: "not_found" };
  return {
    status: "ok",
    template,
    ctx: { data, page: route.page, query: route.query, product: route.product, basePath: req.basePath, href: makeHref(req.basePath, req.carryQuery), mediaUrl: req.mediaUrl ?? (() => null) },
  };
}
