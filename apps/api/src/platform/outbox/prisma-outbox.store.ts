import { db } from "../../lib/db.js";
import type { ClaimedEvent, OutboxStore } from "./relay.js";

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

  async markFailed(id: string, retryInMs: number, reason: string): Promise<void> {
    await db.$executeRaw`
      UPDATE "OutboxEvent" SET "availableAt" = now() + (${retryInMs}::integer * interval '1 millisecond'), "lastError" = ${reason.slice(0, 200)}
      WHERE "id" = ${id} AND "publishedAt" IS NULL`;
  }
}
