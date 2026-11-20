import type { PublicStoreDto } from "@store-builder/shared/dto/index";
import { callApi } from "@/lib/api-client";

/**
 * Cookie-less reads of PUBLISHED stores. Kept free of `next/headers` so the proxy (which runs before every request) can use it.
 * `null` for 404 (every unavailable case looks the same); any other unexpected answer throws.
 */
export class PublicApiError extends Error {
  constructor(readonly status: number) {
    super(`API answered ${status}`);
    this.name = "PublicApiError";
  }
}

async function publicGet<T>(path: string, query?: Record<string, string | undefined>): Promise<T | null> {
  const r = await callApi<T>("GET", path, { query });
  if (r.status === 404) return null;
  if (r.status < 200 || r.status >= 300) throw new PublicApiError(r.status);
  return r.body;
}

export const getPublicStore = (label: string) => publicGet<PublicStoreDto>(`/api/public/stores/${encodeURIComponent(label)}`);

/** Where a historical product slug now lives in the live version, or null. */
export async function resolveProductRedirect(label: string, slug: string): Promise<string | null> {
  const r = await publicGet<{ to: string }>(`/api/public/stores/${encodeURIComponent(label)}/product-redirect`, { slug });
  return r?.to ?? null;
}
