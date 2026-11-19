import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { LockContext } from "@/modules/stores/mutation";
import { RATE_WINDOW_MS, type PublishLimits } from "./constants";
import { PublishRateLimitedError, RedirectLimitError, ReservedSlugLimitError, SlugHistoryLimitError, SlugReservationConflictError } from "./errors";

/**
 * Writes to the published-data tables. Every function takes a LockContext (store row locked, no draftRevision bump), so a
 * write without the lock does not compile. Reads for the dashboard are owner-scoped and never select the snapshot column.
 */
export const newVersionId = (): string => `v${randomBytes(15).toString("base64url")}`;

const utc = (d: Date) => d.toISOString();

export async function hasSubdomain(ctx: LockContext): Promise<boolean> {
  return (await ctx.tx.domain.findFirst({ where: { storeId: ctx.storeId, kind: "SUBDOMAIN" }, select: { id: true } })) !== null;
}

/** Sliding window: versions created strictly after `now - 1 hour` count. Serialised by the store lock, so it is exact. */
export async function assertWithinPublishRate(ctx: LockContext, now: Date, limits: PublishLimits): Promise<void> {
  const since = new Date(now.getTime() - RATE_WINDOW_MS);
  const count = await ctx.tx.storeVersion.count({ where: { storeId: ctx.storeId, createdAt: { gt: since } } });
  if (count < limits.maxPublishesPerHour) return;
  const oldest = await ctx.tx.storeVersion.findFirst({ where: { storeId: ctx.storeId, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const retryAfter = oldest ? oldest.createdAt.getTime() + RATE_WINDOW_MS - now.getTime() : 1;
  throw new PublishRateLimitedError(Math.max(1, retryAfter), limits.maxPublishesPerHour);
}

export async function liveContentHash(ctx: LockContext): Promise<string | null> {
  if (ctx.store.status !== "PUBLISHED" || !ctx.store.publishedVersionId) return null;
  const v = await ctx.tx.storeVersion.findUnique({ where: { id: ctx.store.publishedVersionId }, select: { contentHash: true } });
  return v?.contentHash ?? null;
}

/** MAX(number) + 1 over ALL versions of the store (never the live pointer), under the store lock. */
export async function nextVersionNumber(ctx: LockContext): Promise<number> {
  const max = await ctx.tx.storeVersion.aggregate({ where: { storeId: ctx.storeId }, _max: { number: true } });
  return (max._max.number ?? 0) + 1;
}

/** The snapshot travels as a bound text parameter cast to jsonb (never concatenated into SQL). */
export async function insertVersion(
  ctx: LockContext,
  v: { id: string; number: number; draftRevision: number; text: string; hash: string; bytes: number; createdAt: Date },
): Promise<void> {
  await ctx.tx.$executeRaw`
    INSERT INTO "StoreVersion" ("id", "storeId", "number", "draftRevision", "snapshot", "contentHash", "snapshotBytes", "createdAt")
    VALUES (${v.id}, ${ctx.storeId}, ${v.number}, ${v.draftRevision}, ${v.text}::jsonb, ${v.hash}, ${v.bytes}, (${utc(v.createdAt)}::timestamptz AT TIME ZONE 'UTC'))`;
}

export async function insertVersionProducts(ctx: LockContext, versionId: string, rows: { productId: string; slug: string }[]): Promise<void> {
  if (rows.length === 0) return;
  await ctx.tx.storeVersionProduct.createMany({ data: rows.map((r) => ({ versionId, productId: r.productId, slug: r.slug })) });
}

interface SlugProduct {
  id: string;
  name: string;
  slug: string;
}

/**
 * Records every (product, slug) of the new snapshot in `PublishedSlug` and enforces, BEFORE anything is visible:
 *  - a slug reserved for another product is a conflict (never silently reassigned)
 *  - at most 1 + maxHistorical reserved slugs per product
 *  - at most `maxRedirectsPerVersion` redirects in the version (explicit assertion, independent of the derived caps)
 *  - at most `maxReservedSlugsPerStore` reserved slugs per store
 * The checks run prospectively and again on the stored rows after the insert; the database trigger is a third line of defence.
 */
export async function reserveSlugs(ctx: LockContext, products: SlugProduct[], limits: PublishLimits): Promise<void> {
  const ids = products.map((p) => p.id);
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const owned = ids.length ? await ctx.tx.publishedSlug.findMany({ where: { storeId: ctx.storeId, productId: { in: ids } }, select: { productId: true, slug: true } }) : [];
  const taken = products.length ? await ctx.tx.publishedSlug.findMany({ where: { storeId: ctx.storeId, slug: { in: [...bySlug.keys()] } }, select: { productId: true, slug: true } }) : [];
  for (const t of taken) if (bySlug.get(t.slug)!.id !== t.productId) throw new SlugReservationConflictError(t.slug);

  const sets = new Map<string, Set<string>>();
  for (const o of owned) (sets.get(o.productId) ?? sets.set(o.productId, new Set()).get(o.productId)!).add(o.slug);
  for (const p of products) (sets.get(p.id) ?? sets.set(p.id, new Set()).get(p.id)!).add(p.slug);

  const tooMany = products.filter((p) => sets.get(p.id)!.size > limits.maxHistoricalSlugsPerProduct + 1);
  if (tooMany.length) throw new SlugHistoryLimitError(tooMany.map((p) => ({ id: p.id, name: p.name })), limits.maxHistoricalSlugsPerProduct);
  const redirects = products.reduce((n, p) => n + sets.get(p.id)!.size - 1, 0);
  if (redirects > limits.maxRedirectsPerVersion) throw new RedirectLimitError(redirects, limits.maxRedirectsPerVersion);
  const storeTotal = await ctx.tx.publishedSlug.count({ where: { storeId: ctx.storeId } });
  const fresh = products.filter((p) => !owned.some((o) => o.productId === p.id && o.slug === p.slug));
  if (storeTotal + fresh.length > limits.maxReservedSlugsPerStore) throw new ReservedSlugLimitError(storeTotal + fresh.length, limits.maxReservedSlugsPerStore);

  if (fresh.length) await ctx.tx.publishedSlug.createMany({ data: fresh.map((p) => ({ storeId: ctx.storeId, productId: p.id, slug: p.slug })), skipDuplicates: true });

  // The same limits, asserted again on what is now stored in this transaction (nothing is visible before COMMIT).
  const counts = ids.length ? await ctx.tx.publishedSlug.groupBy({ by: ["productId"], where: { storeId: ctx.storeId, productId: { in: ids } }, _count: { _all: true } }) : [];
  const stored = new Map(counts.map((c) => [c.productId, c._count._all]));
  const over = products.filter((p) => (stored.get(p.id) ?? 0) > limits.maxHistoricalSlugsPerProduct + 1);
  if (over.length) throw new SlugHistoryLimitError(over.map((p) => ({ id: p.id, name: p.name })), limits.maxHistoricalSlugsPerProduct);
  const storedRedirects = products.reduce((n, p) => n + Math.max(0, (stored.get(p.id) ?? 1) - 1), 0);
  if (storedRedirects > limits.maxRedirectsPerVersion) throw new RedirectLimitError(storedRedirects, limits.maxRedirectsPerVersion);
  const total = await ctx.tx.publishedSlug.count({ where: { storeId: ctx.storeId } });
  if (total > limits.maxReservedSlugsPerStore) throw new ReservedSlugLimitError(total, limits.maxReservedSlugsPerStore);
}

export async function setLive(ctx: LockContext, versionId: string, at: Date): Promise<void> {
  const res = await ctx.tx.store.updateMany({ where: { id: ctx.storeId, ownerId: ctx.ownerId }, data: { status: "PUBLISHED", publishedVersionId: versionId, publishedAt: at } });
  if (res.count !== 1) throw new Error("store row vanished under its lock");
}

export async function setOffline(ctx: LockContext): Promise<void> {
  const res = await ctx.tx.store.updateMany({ where: { id: ctx.storeId, ownerId: ctx.ownerId }, data: { status: "UNPUBLISHED", publishedVersionId: null } });
  if (res.count !== 1) throw new Error("store row vanished under its lock");
}

export async function findVersionByNumber(ctx: LockContext, number: number) {
  return ctx.tx.storeVersion.findUnique({ where: { storeId_number: { storeId: ctx.storeId, number } }, select: { id: true, number: true } });
}

/** `snapshot->'template'` only: detoasts the document but does not parse it in the application. */
export async function versionTemplate(ctx: LockContext, versionId: string): Promise<{ key?: unknown; version?: unknown } | null> {
  const rows = await ctx.tx.$queryRaw<{ template: { key?: unknown; version?: unknown } | null }[]>`SELECT "snapshot"->'template' AS "template" FROM "StoreVersion" WHERE "id" = ${versionId}`;
  return rows[0]?.template ?? null;
}

/** The slug a product has in the LIVE version (null if it is not in it): replaces the placeholder `getPublishedSlug`. */
export async function liveSlugOf(tx: { $queryRaw: typeof db.$queryRaw }, storeId: string, productId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ slug: string }[]>`
    SELECT p."slug" FROM "Store" s JOIN "StoreVersionProduct" p ON p."versionId" = s."publishedVersionId"
    WHERE s."id" = ${storeId} AND s."status" = 'PUBLISHED' AND p."productId" = ${productId}`;
  return rows[0]?.slug ?? null;
}

// ---- owner-scoped reads for the dashboard (no snapshot column) ----

export interface VersionRow {
  id: string;
  number: number;
  createdAt: Date;
  snapshotBytes: number;
  draftRevision: number;
  contentHash: string;
}

export const listVersionRows = (ownerId: string, storeId: string): Promise<VersionRow[]> =>
  db.storeVersion.findMany({
    where: { storeId, store: { ownerId } },
    orderBy: { number: "desc" },
    select: { id: true, number: true, createdAt: true, snapshotBytes: true, draftRevision: true, contentHash: true },
  });

export const readStoreState = (ownerId: string, storeId: string) =>
  db.store.findFirst({
    where: { id: storeId, ownerId },
    select: {
      status: true,
      draftRevision: true,
      publishedAt: true,
      publishedVersionId: true,
      publishedVersion: { select: { number: true, draftRevision: true, createdAt: true, snapshotBytes: true } },
      domains: { where: { kind: "SUBDOMAIN" }, select: { host: true } },
    },
  });
