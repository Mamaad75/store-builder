import { log } from "../lib/log.js";
import type { EventHandler } from "../platform/queue/event-queue.js";

/**
 * Event type -> consumer. Every consumer must be idempotent (keyed by `event.id`): delivery is at-least-once and unordered.
 *
 * "store.published" is the first event (phase 2.2). Its real consumers arrive in later phases (Torob/Emalls feed refresh,
 * storefront cache purge); until then it only proves the pipeline end to end with one structured log line.
 */
export const EVENT_HANDLERS: Readonly<Record<string, EventHandler>> = {
  "store.published": async (event) => {
    log.info("store.published.received", { eventId: event.id, storeId: event.storeId, occurredAt: event.occurredAt });
  },
};
