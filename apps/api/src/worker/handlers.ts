import { log } from "../lib/log.js";
import type { EventHandler } from "../platform/queue/event-queue.js";

/** Phase 3.6: the order-SMS consumer (notifications module); null = order SMS not configured in this worker. */
export interface OrderSmsConsumer {
  handle(e: { id: string; type: string; storeId: string | null; payload: unknown }): Promise<void>;
}

/**
 * Event type -> consumer. Every consumer must be idempotent (keyed by `event.id`): delivery is at-least-once and unordered.
 *
 * "store.published" is the first event (phase 2.2). Its real consumers arrive in later phases (Torob/Emalls feed refresh,
 * storefront cache purge); until then it only proves the pipeline end to end with one structured log line.
 * Phase 3.6: the order events feed the order SMS (keyed by event id and message kind, so a re-delivery sends nothing twice); a failed
 * send throws, and the queue retries the event.
 */
export function createEventHandlers(o: { orderSms: OrderSmsConsumer | null }): Readonly<Record<string, EventHandler>> {
  const orderEvent =
    (name: string): EventHandler =>
    async (event) => {
      log.info(`${name}.received`, { eventId: event.id, storeId: event.storeId, occurredAt: event.occurredAt });
      if (o.orderSms) await o.orderSms.handle({ id: event.id, type: event.type, storeId: event.storeId, payload: event.payload });
    };
  return {
    "store.published": async (event) => {
      log.info("store.published.received", { eventId: event.id, storeId: event.storeId, occurredAt: event.occurredAt });
    },
    "order.placed": orderEvent("order.placed"),
    "order.status_changed": orderEvent("order.status_changed"),
    "order.receipt_submitted": orderEvent("order.receipt_submitted"),
    "order.receipt_rejected": orderEvent("order.receipt_rejected"),
  };
}

/** The handlers without order SMS (tests and tools that only need the event types). */
export const EVENT_HANDLERS = createEventHandlers({ orderSms: null });
