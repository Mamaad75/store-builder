import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "./errors";

declare const mutationBrand: unique symbol;

/**
 * Proof that the caller owns the store and that the store row is locked and its draftRevision
 * bumped inside the current transaction. Repository write functions require it, and only
 * `withStoreMutation` can create one, so a write without it does not compile.
 */
export interface MutationContext {
  readonly [mutationBrand]: true;
  readonly tx: Prisma.TransactionClient;
  readonly storeId: string;
  readonly ownerId: string;
}

/**
 * Runs `fn` in a transaction whose FIRST statement is
 *   UPDATE "Store" SET "draftRevision" = "draftRevision" + 1 WHERE id = ? AND "ownerId" = ?
 * - ownership is enforced in SQL (0 rows => NotFoundError, same for foreign and missing stores)
 * - the store row stays locked until commit, serialising every catalog write of that store
 *   (limits, slug generation and status changes are therefore race-free)
 * - if `fn` throws, the whole transaction rolls back, so a failed mutation never bumps the revision
 * Lock order everywhere: Store row -> category -> product.
 */
export async function withStoreMutation<T>(
  ownerId: string,
  storeId: string,
  fn: (ctx: MutationContext) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      const bumped = await tx.store.updateMany({
        where: { id: storeId, ownerId },
        data: { draftRevision: { increment: 1 } },
      });
      if (bumped.count !== 1) throw new NotFoundError();
      return fn({ tx, storeId, ownerId } as unknown as MutationContext);
    },
    { timeout: 15_000, maxWait: 10_000 },
  );
}

declare const lockBrand: unique symbol;

export interface LockedStore {
  draftRevision: number;
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  publishedVersionId: string | null;
  templateVersionId: string;
}

/**
 * Proof that the caller owns the store and holds its row lock in the current transaction WITHOUT having bumped
 * `draftRevision`. Publishing, versions, slug reservations and subdomains are not draft-content mutations, so they use
 * this context instead of `MutationContext`; repository functions for those tables accept only this type.
 */
export interface LockContext {
  readonly [lockBrand]: true;
  readonly tx: Prisma.TransactionClient;
  readonly storeId: string;
  readonly ownerId: string;
  /** The row as it was read under the lock. */
  readonly store: LockedStore;
}

/** The store lock could not be acquired in time (PostgreSQL lock_timeout, SQLSTATE 55P03). Nothing was written. */
export class StoreLockBusyError extends Error {
  constructor() {
    super("The store is busy");
    this.name = "StoreLockBusyError";
  }
}

/** Extracts the 5-character SQLSTATE from a Prisma error (raw and model queries report it differently). */
export function pgErrorCode(e: unknown): string | null {
  const err = e as { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown } | null;
  if (err?.meta && typeof err.meta.code === "string" && /^[0-9A-Z]{5}$/.test(err.meta.code)) return err.meta.code;
  const text = `${typeof err?.message === "string" ? err.message : ""} ${typeof err?.meta?.message === "string" ? err.meta.message : ""}`;
  const m = /(?:Code: `|code: ")([0-9A-Z]{5})/.exec(text);
  if (m) return m[1]!;
  if (/canceling statement due to lock timeout/i.test(text)) return "55P03";
  if (/canceling statement due to statement timeout/i.test(text)) return "57014";
  return null;
}

/**
 * Runs `fn` in a transaction whose FIRST statement locks the owner's store row (`FOR UPDATE`) and does NOT bump
 * `draftRevision`.
 *  - ownership is enforced in SQL (0 rows => NotFoundError, identical for foreign and missing stores)
 *  - every draft writer starts with an UPDATE of this same row, so while this transaction runs no draft change can commit
 *    and none that already started can still be in flight: everything `fn` reads is one consistent state
 *  - `lock_timeout` bounds the wait for the lock; a timeout is a retryable StoreLockBusyError and nothing was written
 * Returns the value and how long the lock was held, measured from acquisition to the end of COMMIT.
 */
export async function withStoreLock<T>(
  ownerId: string,
  storeId: string,
  fn: (ctx: LockContext) => Promise<T>,
  opts: { lockTimeoutMs?: number; txTimeoutMs?: number } = {},
): Promise<{ value: T; heldMs: number }> {
  const lockTimeoutMs = opts.lockTimeoutMs ?? 5_000;
  let acquiredAt = 0;
  try {
    const value = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)`;
        const rows = await tx.$queryRaw<LockedStore[]>`
          SELECT "draftRevision", "status"::text AS "status", "publishedVersionId", "templateVersionId"
          FROM "Store" WHERE "id" = ${storeId} AND "ownerId" = ${ownerId} FOR UPDATE`;
        if (rows.length !== 1) throw new NotFoundError();
        acquiredAt = performance.now();
        return fn({ tx, storeId, ownerId, store: rows[0]! } as unknown as LockContext);
      },
      { timeout: opts.txTimeoutMs ?? 20_000, maxWait: 10_000 },
    );
    return { value, heldMs: performance.now() - acquiredAt };
  } catch (e) {
    if (acquiredAt === 0 && pgErrorCode(e) === "55P03") throw new StoreLockBusyError();
    throw e;
  }
}
