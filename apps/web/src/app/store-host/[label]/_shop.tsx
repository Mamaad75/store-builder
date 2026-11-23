import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { buildView } from "@/templates/engine/view";
import { hostNamesLabel, loadPublicStore, safeMediaUrl } from "./_public";

/** Shop pages (cart, checkout, order) are personal: never indexed, never cached. */
export const shopMetadata = (title: string): Metadata => ({ title, robots: { index: false, follow: false } });

/**
 * The cart, checkout and order pages of a LIVE store (phases 3.3/3.4), inside the store's own theme chrome: the theme's Layout (header,
 * menu, footer) around a shop component. The same host check and published-store loader as every public route; every unavailable case
 * is the same neutral 404. The shop components talk to /api/shop/* on this host from the browser.
 */
export async function ShopPage({ params, children }: { params: Promise<{ label: string }>; children: ReactNode }) {
  const { label } = await params;
  if (!(await hostNamesLabel(label))) notFound();
  const store = await loadPublicStore(label);
  if (!store) notFound();
  const view = buildView(store.data, { basePath: "", segments: [], mediaUrl: safeMediaUrl });
  if (view.status !== "ok") notFound();
  const { Layout } = view.template;
  return <Layout ctx={{ ...view.ctx, commerce: true }}>{children}</Layout>;
}
