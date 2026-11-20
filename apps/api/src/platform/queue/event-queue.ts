import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { ClaimedEvent, EventPublisher } from "../outbox/relay.js";

/**
 * The queue side of domain events (ADR 0002 §2.8), on BullMQ + Valkey. The only files that import bullmq/ioredis live in this
 * folder (architecture guard): everything else depends on EventPublisher / EventHandler.
 */
export const DOMAIN_EVENTS_QUEUE = "domain-events";
/** Key prefix of every queue key, so the queue can share a Valkey instance with future uses (cache, idempotency keys). */
export const QUEUE_PREFIX = "sb";

/** What a consumer receives. `id` is the outbox event id: the idempotency key of every consumer. */
export interface EventEnvelope {
  id: string;
  type: string;
  storeId: string | null;
  payload: unknown;
  occurredAt: string;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

/** Retry policy of one event delivery to its consumer (independent of the relay's retries into the queue). */
export interface DeliveryPolicy {
  attempts: number;
  backoffMs: number;
  keepCompletedSeconds: number;
  keepFailedSeconds: number;
}

export const DELIVERY: DeliveryPolicy = {
  attempts: 8,
  backoffMs: 5_000,
  /** Completed jobs are kept this long, so a re-published event (same jobId) is ignored instead of handled twice. */
  keepCompletedSeconds: 24 * 3600,
  keepFailedSeconds: 14 * 24 * 3600,
};

/** One connection per process; BullMQ requires maxRetriesPerRequest = null for workers. The URL (may hold a password) is never logged. */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function createEventQueue(connection: Redis, prefix: string = QUEUE_PREFIX): Queue {
  return new Queue(DOMAIN_EVENTS_QUEUE, { connection, prefix });
}

export function toEnvelope(e: ClaimedEvent): EventEnvelope {
  return { id: e.id, type: e.type, storeId: e.storeId, payload: e.payload, occurredAt: new Date(e.occurredAt).toISOString() };
}

export class BullMqEventPublisher implements EventPublisher {
  constructor(
    private readonly queue: Pick<Queue, "add">,
    private readonly delivery: DeliveryPolicy = DELIVERY,
  ) {}

  async publish(event: ClaimedEvent): Promise<void> {
    await this.queue.add(event.type, toEnvelope(event), {
      jobId: event.id, // cuid: never contains ':' and is never digits-only (both are refused as custom ids)
      attempts: this.delivery.attempts,
      backoff: { type: "exponential", delay: this.delivery.backoffMs },
      removeOnComplete: { age: this.delivery.keepCompletedSeconds },
      removeOnFail: { age: this.delivery.keepFailedSeconds },
    });
  }
}

export interface EventWorkerHooks {
  log: { info(event: string, fields?: Record<string, unknown>): void; error(event: string, fields?: Record<string, unknown>): void };
  /** Called once when a delivery has used up all its attempts. Must never throw. */
  onFinalFailure?: (fields: Record<string, unknown>) => Promise<void>;
}

/** Dispatches each job to the handler registered for its event type. A type without a handler is acknowledged and logged. */
export async function dispatch(handlers: Readonly<Record<string, EventHandler>>, job: Pick<Job<EventEnvelope>, "name" | "data">, hooks: EventWorkerHooks): Promise<void> {
  const handler = handlers[job.name];
  if (!handler) {
    hooks.log.info("event.unhandled", { type: job.name, eventId: job.data.id });
    return;
  }
  await handler(job.data);
}

export function startEventWorker(
  connection: Redis,
  handlers: Readonly<Record<string, EventHandler>>,
  hooks: EventWorkerHooks,
  opts: { concurrency?: number; prefix?: string } = {},
): Worker<EventEnvelope> {
  const worker = new Worker<EventEnvelope>(DOMAIN_EVENTS_QUEUE, (job) => dispatch(handlers, job, hooks), {
    connection,
    prefix: opts.prefix ?? QUEUE_PREFIX,
    concurrency: opts.concurrency ?? 5,
  });
  worker.on("failed", (job, err) => {
    if (!job) return;
    const fields = { type: job.name, eventId: job.data.id, attemptsMade: job.attemptsMade, errorClass: err.name };
    hooks.log.error("event.handler_failed", fields);
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) void hooks.onFinalFailure?.(fields);
  });
  // Connection problems are retried by ioredis; log the class only (messages can carry the host).
  worker.on("error", (err) => hooks.log.error("event.worker_error", { errorClass: err.name }));
  return worker;
}
