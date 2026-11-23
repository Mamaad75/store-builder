import { db } from "../../lib/db.js";
import { storefrontDataSchema, type StorefrontData } from "@store-builder/shared/templates/storefront-data";
import { SNAPSHOT_CACHE_BYTES } from "./constants.js";
import { ByteLru } from "./lru.js";

/**
 * Everything the PUBLIC side may read, in one place. It touches only Domain, Store (status and live pointer),
 * StoreVersion, StoreVersionProduct, PublishedSlug and LivePrice (the public projection of linked prices, phase 3.2b) - never a draft
 * table (Page, Product, ProductCategory, Media).
 * An architecture test and a SQL-capture test enforce that.
 */

export interface LiveStore {
  storeId: string;
  versionId: string;
  /** When this version went live (publish, rollback or republish); used as the sitemap `lastmod`. */
  liveSince: Date;
}

/** The live version of the store that owns this subdomain, or null (unknown, never published, unpublished, released). */
export async function resolveLiveStore(label: string): Promise<LiveStore | null> {
  const rows = await db.$queryRaw<LiveStore[]>`
    SELECT s."id" AS "storeId", s."publishedVersionId" AS "versionId", COALESCE(s."publishedAt", now()) AS "liveSince"
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

/** How long the public side reuses a store's live prices (phase 3.2b): a rate change reaches the storefront within this time. */
export const LIVE_PRICE_TTL_MS = 60_000;
const LIVE_PRICE_CACHE_MAX = 5_000;
const livePriceCache = new Map<string, { at: number; prices: Map<string, number> }>();

/**
 * Current prices of a store's LINKED products and variants (phase 3.2b, D32b-1), keyed "productId|target" (target = variant id or "-").
 * LivePrice is a public projection written only by repricing, not a draft table. Cached per store for LIVE_PRICE_TTL_MS (bounded).
 */
export async function livePricesOf(storeId: string, now = Date.now()): Promise<Map<string, number>> {
  const hit = livePriceCache.get(storeId);
  if (hit && now - hit.at < LIVE_PRICE_TTL_MS) return hit.prices;
  const rows = await db.$queryRaw<{ productId: string; target: string; priceToman: number }[]>`
    SELECT "productId", "target", "priceToman" FROM "LivePrice" WHERE "storeId" = ${storeId}`;
  const prices = new Map(rows.map((r) => [`${r.productId}|${r.target}`, r.priceToman]));
  if (livePriceCache.size >= LIVE_PRICE_CACHE_MAX) livePriceCache.delete(livePriceCache.keys().next().value!);
  livePriceCache.set(storeId, { at: now, prices });
  return prices;
}

/** Tests only. */
export function clearLivePriceCache(): void {
  livePriceCache.clear();
}

/**
 * The published data with linked prices brought up to date. Returns a NEW object (the cached snapshot is shared and immutable) and touches
 * only products and variants that are in the published version: a link never adds or reveals anything that was not published.
 *  - a published product WITH variants: each published variant takes its live price, and the product shows the lowest of the PUBLISHED
 *    variants (security review 3.2b: a variant that exists only in the draft never influences the live price);
 *  - a published product without variants: its own live price ("-").
 */
export function withLivePrices(data: StorefrontData, prices: Map<string, number>): StorefrontData {
  if (prices.size === 0) return data;
  let changed = false;
  const products = data.products.map((p) => {
    if (p.variants.length > 0) {
      let variantsChanged = false;
      const variants = p.variants.map((v) => {
        const lp = prices.get(`${p.id}|${v.id}`);
        if (lp === undefined || lp === v.price) return v;
        variantsChanged = true;
        return { ...v, price: lp };
      });
      if (!variantsChanged) return p;
      changed = true;
      return { ...p, variants, price: Math.min(...variants.map((v) => v.price)) };
    }
    const own = prices.get(`${p.id}|-`);
    if (own === undefined || own === p.price) return p;
    changed = true;
    return { ...p, price: own };
  });
  return changed ? { ...data, products } : data;
}
