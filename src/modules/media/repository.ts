import type { MediaStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { MutationContext } from "@/modules/stores/mutation";

export const mediaSelect = { id: true, key: true, width: true, height: true, sizeBytes: true, mimeType: true, status: true, createdAt: true } satisfies Prisma.MediaSelect;
export type MediaRow = Prisma.MediaGetPayload<{ select: typeof mediaSelect }>;

/** Every query carries the store AND, through the store relation, the owner: ownership is decided in SQL. */
const scope = (ctx: MutationContext, id?: string) => ({ ...(id ? { id } : {}), storeId: ctx.storeId, store: { ownerId: ctx.ownerId } });

export const findMediaInTx = (ctx: MutationContext, id: string): Promise<MediaRow | null> =>
  ctx.tx.media.findFirst({ where: scope(ctx, id), select: mediaSelect });

/** Count and bytes of every row that occupies quota (PENDING reservations and DELETING tombstones included). */
export async function quotaUsage(ctx: MutationContext): Promise<{ count: number; bytes: number }> {
  const a = await ctx.tx.media.aggregate({ where: scope(ctx), _count: { _all: true }, _sum: { sizeBytes: true } });
  return { count: a._count._all, bytes: a._sum.sizeBytes ?? 0 };
}

export interface NewMediaRow {
  key: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export function insertPendingMedia(ctx: MutationContext, row: NewMediaRow): Promise<MediaRow> {
  return ctx.tx.media.create({ data: { ...row, storeId: ctx.storeId, uploadedById: ctx.ownerId, status: "PENDING" }, select: mediaSelect });
}

const transition = async (ctx: MutationContext, id: string, from: MediaStatus, to: MediaStatus) =>
  (await ctx.tx.media.updateMany({ where: { ...scope(ctx, id), status: from }, data: { status: to } })).count === 1;

export const markMediaReady = (ctx: MutationContext, id: string) => transition(ctx, id, "PENDING", "READY");
export const markMediaDeleting = (ctx: MutationContext, id: string) => transition(ctx, id, "READY", "DELETING");

/** Only ever deletes a row in the expected status; the FKs additionally refuse rows that are referenced. */
export async function deleteMediaRow(ctx: MutationContext, id: string, status: MediaStatus): Promise<boolean> {
  return (await ctx.tx.media.deleteMany({ where: { ...scope(ctx, id), status } })).count === 1;
}

/**
 * Is the media referenced by anything that must keep the object alive?
 *  - a product image, the store logo (also protected by the composite foreign keys)
 *  - any page section that mentions the media id (sections are JSON, so no FK can protect them)
 *  - any StoreVersion snapshot (the published site and its rollbacks) that mentions the object key
 * New kinds of reference must be added here.
 */
export async function isMediaReferenced(ctx: MutationContext, media: { id: string; key: string }): Promise<boolean> {
  const [products, logos] = await Promise.all([
    ctx.tx.product.count({ where: { storeId: ctx.storeId, imageId: media.id } }),
    ctx.tx.store.count({ where: { id: ctx.storeId, logoId: media.id } }),
  ]);
  if (products > 0 || logos > 0) return true;
  const rows = await ctx.tx.$queryRaw<{ used: boolean }[]>`
    SELECT (
      EXISTS (SELECT 1 FROM "Page" WHERE "storeId" = ${ctx.storeId} AND position(${media.id} in "sections"::text) > 0)
      OR EXISTS (SELECT 1 FROM "StoreVersion" WHERE "storeId" = ${ctx.storeId} AND position(${media.key} in "snapshot"::text) > 0)
    ) AS used`;
  return rows[0]?.used === true;
}

export async function setStoreLogoRow(ctx: MutationContext, mediaId: string | null): Promise<{ previous: string | null } | null> {
  const store = await ctx.tx.store.findFirst({ where: { id: ctx.storeId, ownerId: ctx.ownerId }, select: { logoId: true } });
  if (!store) return null;
  await ctx.tx.store.updateMany({ where: { id: ctx.storeId, ownerId: ctx.ownerId }, data: { logoId: mediaId } });
  return { previous: store.logoId };
}

// ---- system (cleanup) access: not tied to an owner, never exposed to request handlers ----

export const listPendingOlderThan = (cutoff: Date, take: number) =>
  db.media.findMany({ where: { status: "PENDING", createdAt: { lt: cutoff } }, select: { id: true, key: true }, orderBy: { createdAt: "asc" }, take });

export const listDeletingOlderThan = (cutoff: Date, take: number) =>
  db.media.findMany({ where: { status: "DELETING", createdAt: { lt: cutoff } }, select: { id: true, key: true }, orderBy: { createdAt: "asc" }, take });

/** Status-conditional, so a row that moved on (e.g. PENDING -> READY) is never removed by a stale cleanup decision. */
export async function deleteMediaRowIfStatus(id: string, status: MediaStatus): Promise<boolean> {
  return (await db.media.deleteMany({ where: { id, status } })).count === 1;
}

export async function existingMediaKeys(keys: string[]): Promise<Set<string>> {
  const rows = await db.media.findMany({ where: { key: { in: keys } }, select: { key: true } });
  return new Set(rows.map((r) => r.key));
}

/**
 * Atomically turns an expired PENDING row into a DELETING tombstone. If the upload completed in the meantime
 * (row is READY) the condition fails and the media is left alone, so an object is only deleted after the row
 * has been claimed.
 */
export async function claimExpiredPending(id: string, cutoff: Date): Promise<boolean> {
  return (await db.media.updateMany({ where: { id, status: "PENDING", createdAt: { lt: cutoff } }, data: { status: "DELETING" } })).count === 1;
}
