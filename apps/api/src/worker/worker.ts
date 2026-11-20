import type { Notifier } from "../lib/alert.js";
import { log } from "../lib/log.js";
import { PrismaOutboxStore } from "../platform/outbox/prisma-outbox.store.js";
import { RELAY_DEFAULTS, relayOnce, type OutboxStore } from "../platform/outbox/relay.js";
import { BullMqEventPublisher, createEventQueue, createRedisConnection, startEventWorker, type DeliveryPolicy, type EventHandler } from "../platform/queue/event-queue.js";

export interface RunningWorker {
  /** Stops polling, lets in-flight jobs finish, closes the queue connections. */
  stop(): Promise<void>;
}

export interface WorkerOptions {
  redisUrl: string;
  handlers: Readonly<Record<string, EventHandler>>;
  alert: Notifier;
  store?: OutboxStore;
  idlePollMs?: number;
  /** Test seams: an isolated key prefix and a faster retry policy. */
  prefix?: string;
  delivery?: DeliveryPolicy;
}

/**
 * The worker process (phase 2.2): the outbox relay loop plus the domain-event consumers. The database handle (`useDb`) must be set
 * by the caller. One relay loop per process; several processes are safe (claims use SKIP LOCKED and leases).
 */
export function startWorker(o: WorkerOptions): RunningWorker {
  const connection = createRedisConnection(o.redisUrl);
  const queue = createEventQueue(connection, o.prefix);
  const deps = { store: o.store ?? new PrismaOutboxStore(), publisher: new BullMqEventPublisher(queue, o.delivery), log, alert: o.alert };
  const consumer = startEventWorker(connection, o.handlers, { log, onFinalFailure: (fields) => o.alert("event.dead", fields) }, { prefix: o.prefix });

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<unknown> = Promise.resolve();
  const loop = async () => {
    if (stopping) return;
    let full = false;
    try {
      const r = await relayOnce(deps);
      full = r.claimed === RELAY_DEFAULTS.batchSize;
    } catch (e) {
      // A failed claim (database down) is retried on the next tick; class only, never the message.
      log.error("outbox.relay_failed", { errorClass: e instanceof Error ? e.name : "UnknownError" });
    }
    if (!stopping) timer = setTimeout(() => (current = loop()), full ? 0 : (o.idlePollMs ?? RELAY_DEFAULTS.idlePollMs));
  };
  current = loop();
  log.info("worker.start", { queues: [queue.name], handlers: Object.keys(o.handlers) });

  return {
    async stop() {
      stopping = true;
      if (timer) clearTimeout(timer);
      await current;
      await consumer.close();
      await queue.close();
      connection.disconnect();
      log.info("worker.stop");
    },
  };
}
