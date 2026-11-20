import type { Prisma } from "@prisma/client";

/**
 * Transactional outbox, write side (ADR 0002 §2.8). The ONLY way application code emits a domain event: the row is inserted in
 * the caller's transaction, so the event exists if and only if the change it describes committed (a rollback removes both).
 * Delivery is at-least-once (see relay.ts): every consumer must be idempotent, keyed by the event id.
 */

/** "<context>.<event>" in lower case, e.g. "store.published" (the database enforces the same format). */
export const EVENT_TYPE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$/;

export interface DomainEventInput {
  type: string;
  /** The store the event belongs to (tenant), or null for platform-level events. */
  storeId: string | null;
  /** Ids and small facts only: consumers re-read current state. Never secrets or personal data. */
  payload: Record<string, string | number | boolean | null>;
}

/** Anything that proves an open transaction: MutationContext and LockContext both qualify. */
export interface TransactionScope {
  readonly tx: Prisma.TransactionClient;
}

export class InvalidEventError extends Error {
  constructor(reason: string) {
    super(`invalid domain event: ${reason}`);
    this.name = "InvalidEventError";
  }
}

const MAX_PAYLOAD_BYTES = 8_192;

export async function recordEvent(scope: TransactionScope, event: DomainEventInput): Promise<{ id: string }> {
  if (!EVENT_TYPE_RE.test(event.type) || event.type.length > 100) throw new InvalidEventError("type");
  if (Buffer.byteLength(JSON.stringify(event.payload)) > MAX_PAYLOAD_BYTES) throw new InvalidEventError("payload too large");
  return scope.tx.outboxEvent.create({
    data: { type: event.type, storeId: event.storeId, payload: event.payload },
    select: { id: true },
  });
}
