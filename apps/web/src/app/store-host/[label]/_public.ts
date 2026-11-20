import { cache } from "react";
import { headers } from "next/headers";
import { getAppEnv } from "@/lib/env";
import { resolveHost } from "@store-builder/shared/lib/hostname";
import { mediaPublicUrl } from "@/lib/media-url";
import { publicStoreUrl } from "@/lib/store-url";
import { getPublicStore } from "@/gateway/public";
import type { LiveStoreDto } from "@store-builder/shared/dto/index";
import type { StorefrontData } from "@store-builder/shared/templates/storefront-data";

/**
 * What every public store route needs, in one place: the same host check, the same live-version lookup and the same
 * image-URL rule, so the page, its metadata, its structured data, `robots.txt` and `sitemap.xml` can never disagree.
 * Reads only published data (the API's public endpoint over Domain, the Store pointer and StoreVersion) and only the raw Host header (never forwarded-host headers).
 */

/** The raw Host header must name exactly this label (the proxy rewrote into this namespace, but nothing trusts that). */
export async function hostNamesLabel(label: string): Promise<boolean> {
  const host = resolveHost((await headers()).get("host"), getAppEnv().APP_ROOT_DOMAIN);
  return host.kind === "store" && host.subdomain === label;
}

export interface PublicStore {
  live: LiveStoreDto;
  data: StorefrontData;
  /** `<protocol>://<label>.<APP_ROOT_DOMAIN>` from configuration. */
  baseUrl: string;
}

/** The live, valid published store of this label, or null (all unavailable cases look the same). Deduplicated per request. */
export const loadPublicStore = cache(async (label: string): Promise<PublicStore | null> => {
  const found = await getPublicStore(label);
  if (!found) return null;
  return { live: found.live, data: found.data, baseUrl: publicStoreUrl(label) };
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
