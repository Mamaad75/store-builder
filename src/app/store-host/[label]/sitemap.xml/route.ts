import { buildSitemapXml } from "@/modules/seo/sitemap";
import { hostNamesLabel, loadPublicStore, neutralNotFound } from "../_public";

export const dynamic = "force-dynamic";

/** sitemap.xml of the LIVE version of a published store host (pages, categories with products, every product). */
export async function GET(_req: Request, { params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  if (!(await hostNamesLabel(label))) return neutralNotFound();
  const store = await loadPublicStore(label);
  if (!store) return neutralNotFound();
  return new Response(buildSitemapXml(store.data, store.baseUrl, store.live.liveSince), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
