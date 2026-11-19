import { buildStoreRobotsTxt } from "@/modules/seo/sitemap";
import { hostNamesLabel, loadPublicStore, neutralNotFound } from "../_public";

export const dynamic = "force-dynamic";

/** robots.txt of a PUBLISHED store host. Anything unavailable is the same neutral 404 as every other path. */
export async function GET(_req: Request, { params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  if (!(await hostNamesLabel(label))) return neutralNotFound();
  const store = await loadPublicStore(label);
  if (!store) return neutralNotFound();
  return new Response(buildStoreRobotsTxt(store.baseUrl), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
