import { db } from "@/lib/db";
import { storefrontDataSchema, type StorefrontData } from "@/templates/storefront-data";
import { SNAPSHOT_CACHE_BYTES } from "./constants";
import { ByteLru } from "./lru";

/**
 * Everything the PUBLIC side may read, in one place. It touches only Domain, Store (status and live pointer),
 * StoreVersion, StoreVersionProduct and PublishedSlug - never a draft table (Page, Product, ProductCategory, Media).
 * An architecture test and a SQL-capture test enforce that.
 */

export interface LiveStore {
  storeId: string;
  versionId: string;
}

/** The live version of the store that owns this subdomain, or null (unknown, never published, unpublished, released). */
export async function resolveLiveStore(label: string): Promise<LiveStore | null> {
  const rows = await db.$queryRaw<LiveStore[]>`
    SELECT s."id" AS "storeId", s."publishedVersionId" AS "versionId"
    FROM "Domain" d JOIN "Store" s ON s."id" = d."storeId"
    WHERE d."kind" = 'SUBDOMAIN' AND d."host" = ${label} AND s."status" = 'PUBLISHED' AND s."publishedVersionId" IS NOT NULL`;
  return rows[0] ?? null;
}

/**
 * Where a historical product slug must be redirected (permanently) in the CURRENTLY LIVE version, or null.
 * Resolved dynamically from the append-only slug history and the live version's product index, so it stays correct after
 * any number of renames, publishes, rollbacks and republishes. Snapshots are never touched.
 *  - a slug that is current in the live version never redirects
 *  - a product absent from the live version (deleted, archived, draft) has no redirect: 404
 *  - the target is always a slug that renders, and the source never is: a single hop, no chain, no loop
 */
export async function resolveProductRedirect(label: string, slug: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ to: string }[]>`
    SELECT t."slug" AS "to"
    FROM "Domain" d
    JOIN "Store" s ON s."id" = d."storeId" AND s."status" = 'PUBLISHED' AND s."publishedVersionId" IS NOT NULL
    JOIN "PublishedSlug" ps ON ps."storeId" = s."id" AND ps."slug" = ${slug}
    JOIN "StoreVersionProduct" t ON t."versionId" = s."publishedVersionId" AND t."productId" = ps."productId"
    WHERE d."kind" = 'SUBDOMAIN' AND d."host" = ${label} AND t."slug" <> ${slug}
      AND NOT EXISTS (SELECT 1 FROM "StoreVersionProduct" c WHERE c."versionId" = s."publishedVersionId" AND c."slug" = ${slug})`;
  return rows[0]?.to ?? null;
}

/** Parsed snapshots by version id. Versions are immutable, so a cached entry never goes stale. */
export const snapshotCache = new ByteLru<StorefrontData>(SNAPSHOT_CACHE_BYTES);

/** Loads and validates a published snapshot (null when it does not satisfy the current contract). */
export async function loadPublishedSnapshot(versionId: string): Promise<StorefrontData | null> {
  const hit = snapshotCache.get(versionId);
  if (hit) return hit;
  const rows = await db.$queryRaw<{ snapshot: unknown; bytes: number }[]>`SELECT "snapshot", "snapshotBytes" AS "bytes" FROM "StoreVersion" WHERE "id" = ${versionId}`;
  const row = rows[0];
  if (!row) return null;
  const parsed = storefrontDataSchema.safeParse(row.snapshot);
  if (!parsed.success) return null;
  snapshotCache.set(versionId, parsed.data, Math.max(row.bytes, 1024));
  return parsed.data;
}
