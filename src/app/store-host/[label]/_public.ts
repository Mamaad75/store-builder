import { cache } from "react";
import { headers } from "next/headers";
import { getAppEnv } from "@/lib/env";
import { resolveHost } from "@/lib/hostname";
import { mediaPublicUrl } from "@/lib/storage";
import { publicStoreUrl } from "@/lib/store-url";
import { loadPublishedSnapshot, resolveLiveStore, type LiveStore } from "@/modules/publishing/public-read";
import type { StorefrontData } from "@/templates/storefront-data";

/**
 * What every public store route needs, in one place: the same host check, the same live-version lookup and the same
 * image-URL rule, so the page, its metadata, its structured data, `robots.txt` and `sitemap.xml` can never disagree.
 * Reads only published data (Domain, Store pointer, StoreVersion) and only the raw Host header (never forwarded-host headers).
 */

/** The raw Host header must name exactly this label (the proxy rewrote into this namespace, but nothing trusts that). */
export async function hostNamesLabel(label: string): Promise<boolean> {
  const host = resolveHost((await headers()).get("host"), getAppEnv().APP_ROOT_DOMAIN);
  return host.kind === "store" && host.subdomain === label;
}

export interface PublicStore {
  live: LiveStore;
  data: StorefrontData;
  /** `<protocol>://<label>.<APP_ROOT_DOMAIN>` from configuration. */
  baseUrl: string;
}

/** The live, valid published store of this label, or null (all unavailable cases look the same). Deduplicated per request. */
export const loadPublicStore = cache(async (label: string): Promise<PublicStore | null> => {
  const live = await resolveLiveStore(label);
  if (!live) return null;
  const data = await loadPublishedSnapshot(live.versionId);
  if (!data) return null;
  return { live, data, baseUrl: publicStoreUrl(label) };
});

/** An unconfigured/invalid storage URL must never break a public page: images fall back to placeholders. */
export function safeMediaUrl(key: string): string | null {
  try {
    return mediaPublicUrl(key);
  } catch {
    return null;
  }
}

/** The one neutral answer for everything unavailable on a store host. */
export const neutralNotFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
