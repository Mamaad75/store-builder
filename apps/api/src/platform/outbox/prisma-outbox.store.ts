import { db } from "../../lib/db.js";
import type { ClaimedEvent, OutboxStore } from "./relay.js";

/** Published events are kept this long for diagnostics (which consumers ran, when), then deleted. */
export const OUTBOX_RETENTION_DAYS = 7;

/** PostgreSQL side of the relay. Times come from the database clock (now()), never from the worker's clock. */
export class PrismaOutboxStore implements OutboxStore {
  async claim(limit: number, leaseMs: number): Promise<ClaimedEvent[]> {
    return db.$queryRaw<ClaimedEvent[]>`
      UPDATE "OutboxEvent" SET "availableAt" = now() + (${leaseMs}::integer * interval '1 millisecond'), "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "OutboxEvent"
        WHERE "publishedAt" IS NULL AND "availableAt" <= now()
        ORDER BY "availableAt", "id"
        LIMIT ${limit}::integer
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "storeId", "payload", "occurredAt", "attempts"`;
  }

  async markPublished(id: string): Promise<void> {
    await db.$executeRaw`UPDATE "OutboxEvent" SET "publishedAt" = now(), "lastError" = NULL WHERE "id" = ${id} AND "publishedAt" IS NULL`;
  }

  /**
   * Retention (phase 2.2b, run by db-cleanup): deletes PUBLISHED events older than `retentionDays`, in batches that skip rows another
   * transaction holds. Unpublished events are never deleted, however old: they are the only copy of an undelivered event.
   */
  async purgePublished(retentionDays = OUTBOX_RETENTION_DAYS, batch = 1_000, maxBatches = 50): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const deleted = await db.$executeRaw`
        DELETE FROM "OutboxEvent" WHERE "id" IN (
          SELECT "id" FROM "OutboxEvent"
          WHERE "publishedAt" IS NOT NULL AND "publishedAt" < now() - (${retentionDays}::integer * interval '1 day')
          LIMIT ${batch}::integer FOR UPDATE SKIP LOCKED)`;
      total += deleted;
      if (deleted < batch) break;
    }
    return total;
  }

  async markFailed(id: string, retryInMs: number, reason: string): Promise<void> {
    await db.$executeRaw`
      UPDATE "OutboxEvent" SET "availableAt" = now() + (${retryInMs}::integer * interval '1 millisecond'), "lastError" = ${reason.slice(0, 200)}
      WHERE "id" = ${id} AND "publishedAt" IS NULL`;
  }
}
