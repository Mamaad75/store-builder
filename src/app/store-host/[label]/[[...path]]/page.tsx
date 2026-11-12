import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getAppEnv } from "@/lib/env";
import { resolveHost } from "@/lib/hostname";
import { mediaPublicUrl } from "@/lib/storage";
import { loadPublishedSnapshot, resolveLiveStore } from "@/modules/publishing/public-read";
import StorefrontRenderer from "@/templates/engine/StorefrontRenderer";
import { buildView } from "@/templates/engine/view";

// Per request: the live version can change at any moment (publish, rollback, unpublish).
export const dynamic = "force-dynamic";

/** An unconfigured/invalid storage URL must never break a public page: images fall back to placeholders. */
function safeMediaUrl(key: string): string | null {
  try {
    return mediaPublicUrl(key);
  } catch {
    return null;
  }
}

/**
 * The PUBLIC storefront of a subdomain: renders only the immutable published snapshot, never a draft table.
 * Every unavailable case (unknown host, unknown label, never published, unpublished, unsupported theme, invalid snapshot,
 * unknown page) is the same neutral 404, so nothing reveals whether a store exists.
 */
export default async function StorePage({ params, searchParams }: { params: Promise<{ label: string; path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { label, path = [] } = await params;
  // The proxy rewrote into this namespace, but the page does not trust that: the Host header itself must name this label.
  const host = resolveHost((await headers()).get("host"), getAppEnv().APP_ROOT_DOMAIN);
  if (host.kind !== "store" || host.subdomain !== label) notFound();

  const live = await resolveLiveStore(label);
  if (!live) notFound();
  const data = await loadPublishedSnapshot(live.versionId);
  if (!data) notFound();
  const view = buildView(data, { basePath: "", segments: path, searchParams: await searchParams, mediaUrl: safeMediaUrl });
  if (view.status !== "ok") notFound();
  return <StorefrontRenderer template={view.template} ctx={view.ctx} />;
}
