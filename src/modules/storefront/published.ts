import { db } from "@/lib/db";
import { storefrontDataSchema, type StorefrontData } from "@/templates/storefront-data";

/**
 * Reader for the PUBLISHED storefront (used by public routing in phase 10; no route uses it yet and
 * nothing writes snapshots yet). It reads only the immutable snapshot the store's published pointer
 * names - never the live draft tables - so draft edits cannot leak into published output.
 * Returns null when the store is not published or the snapshot does not satisfy the contract.
 */
export async function readPublishedStorefront(storeId: string): Promise<StorefrontData | null> {
  const store = await db.store.findFirst({
    where: { id: storeId, status: "PUBLISHED", publishedVersionId: { not: null } },
    select: { publishedVersion: { select: { snapshot: true } } },
  });
  if (!store?.publishedVersion) return null;
  const parsed = storefrontDataSchema.safeParse(store.publishedVersion.snapshot);
  return parsed.success ? parsed.data : null;
}
