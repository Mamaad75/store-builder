/**
 * Outbox relay, pure part (ADR 0002 §2.8). It moves committed events from the outbox table to the queue:
 *  1. claim a batch: due, unpublished rows get a lease (availableAt pushed into the future) and attempts + 1, in one statement with
 *     FOR UPDATE SKIP LOCKED, so several relays never claim the same row and a crashed relay's rows come back after the lease;
 *  2. publish each event with jobId = event id (the queue ignores a second add of the same id while the job is retained);
 *  3. stamp publishedAt, or on failure schedule a retry with exponential backoff and a fixed, non-sensitive reason.
 * Delivery is at-least-once and NOT ordered: consumers must be idempotent and must not rely on order.
 */

export interface ClaimedEvent {
  id: string;
  type: string;
  storeId: string | null;
  payload: unknown;
  occurredAt: Date;
  /** Claims so far, including this one. */
  attempts: number;
}

export interface OutboxStore {
  claim(limit: number, leaseMs: number): Promise<ClaimedEvent[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, retryInMs: number, reason: string): Promise<void>;
}

export interface EventPublisher {
  publish(event: ClaimedEvent): Promise<void>;
}

export interface RelayDeps {
  store: OutboxStore;
  publisher: EventPublisher;
  log: { info(event: string, fields?: Record<string, unknown>): void; error(event: string, fields?: Record<string, unknown>): void };
  /** Operational alert (Bale); must never throw (lib/alert.ts createNotifier). */
  alert?: (event: string, fields: Record<string, unknown>) => Promise<void>;
}

export const RELAY_DEFAULTS = {
  batchSize: 100,
  /** A claimed row is invisible to other relays for this long; must exceed the time to publish one batch. */
  leaseMs: 60_000,
  /** Poll interval when the last batch was not full. */
  idlePollMs: 1_000,
  /** One alert when an event has failed this many times (it keeps being retried). */
  alertAtAttempts: 10,
} as const;

const MAX_RETRY_MS = 5 * 60_000;

/** 1 s, 2 s, 4 s ... capped at 5 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS);
}

/** Error class only: messages can contain hosts, URLs or payload fragments. */
export function failureReason(e: unknown): string {
  const name = e instanceof Error ? e.name : "UnknownError";
  return `publish_failed:${name}`.slice(0, 200);
}

export interface RelayResult {
  claimed: number;
  published: number;
  failed: number;
}

export async function relayOnce(d: RelayDeps, opts: { batchSize?: number; leaseMs?: number } = {}): Promise<RelayResult> {
  const batch = await d.store.claim(opts.batchSize ?? RELAY_DEFAULTS.batchSize, opts.leaseMs ?? RELAY_DEFAULTS.leaseMs);
  let published = 0;
  let failed = 0;
  for (const event of batch) {
    try {
      await d.publisher.publish(event);
      await d.store.markPublished(event.id);
      published += 1;
    } catch (e) {
      failed += 1;
      const reason = failureReason(e);
      const retryInMs = retryDelayMs(event.attempts);
      await d.store.markFailed(event.id, retryInMs, reason);
      d.log.error("outbox.publish_failed", { eventId: event.id, type: event.type, attempts: event.attempts, retryInMs, reason });
      if (event.attempts === RELAY_DEFAULTS.alertAtAttempts) {
        await d.alert?.("outbox.stuck", { eventId: event.id, type: event.type, attempts: event.attempts, reason });
      }
    }
  }
  if (batch.length > 0) d.log.info("outbox.relayed", { claimed: batch.length, published, failed });
  return { claimed: batch.length, published, failed };
}
