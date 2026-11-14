import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/modules/seo/metadata";
import { buildJsonLd } from "@/modules/seo/jsonld";
import StorefrontRenderer from "@/templates/engine/StorefrontRenderer";
import { buildView } from "@/templates/engine/view";
import JsonLd from "../JsonLd";
import { hostNamesLabel, loadPublicStore, safeMediaUrl } from "../_public";

// Per request: the live version can change at any moment (publish, rollback, unpublish).
export const dynamic = "force-dynamic";

type Params = Promise<{ label: string; path?: string[] }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The page's view of the live published store, or null for every unavailable case (the same neutral 404). */
async function resolve(params: Params, searchParams: SearchParams) {
  const { label, path = [] } = await params;
  if (!(await hostNamesLabel(label))) return null;
  const store = await loadPublicStore(label);
  if (!store) return null;
  const view = buildView(store.data, { basePath: "", segments: path, searchParams: await searchParams, mediaUrl: safeMediaUrl });
  return view.status === "ok" ? { store, view } : null;
}

/** Titles, description, canonical, Open Graph and Twitter cards from the PUBLISHED snapshot only (never a draft table). */
export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SearchParams }): Promise<Metadata> {
  const r = await resolve(params, searchParams);
  if (!r) return {}; // the page itself answers notFound(); Next marks that response noindex
  const { data } = r.store;
  return buildMetadata({ data, page: r.view.ctx.page, query: r.view.ctx.query, product: r.view.ctx.product, mediaUrl: safeMediaUrl }, r.store.baseUrl);
}

/**
 * The PUBLIC storefront of a subdomain: renders only the immutable published snapshot, never a draft table.
 * Every unavailable case (unknown host, unknown label, never published, unpublished, unsupported theme, invalid snapshot,
 * unknown page) is the same neutral 404, so nothing reveals whether a store exists.
 */
export default async function StorePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const r = await resolve(params, searchParams);
  if (!r) notFound();
  const { ctx } = r.view;
  const jsonLd = buildJsonLd({ data: ctx.data, page: ctx.page, query: ctx.query, product: ctx.product, mediaUrl: safeMediaUrl }, r.store.baseUrl);
  return (
    <>
      <StorefrontRenderer template={r.view.template} ctx={ctx} />
      <JsonLd items={jsonLd} />
    </>
  );
}
