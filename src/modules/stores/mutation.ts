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
