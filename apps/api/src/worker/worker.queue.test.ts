import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordEvent } from "../platform/outbox/outbox.js";
import { DOMAIN_EVENTS_QUEUE, type EventEnvelope, type EventHandler } from "../platform/queue/event-queue.js";
import { prisma, resetDb } from "../test/db-helpers.js";
import { startWorker, type RunningWorker } from "./worker.js";

/** End to end against a REAL Valkey + PostgreSQL (vitest.queue.config.ts): outbox row -> relay -> BullMQ -> consumer. */
const REDIS_URL = process.env.REDIS_URL!;
const PREFIX = `sbtest${process.pid}`;
const FAST = { attempts: 3, backoffMs: 50, keepCompletedSeconds: 3600, keepFailedSeconds: 3600 };

let worker: RunningWorker | undefined;
const alerts: string[] = [];
const admin = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

async function wipeQueue() {
  for (const name of [DOMAIN_EVENTS_QUEUE, "maintenance"]) {
    const q = new Queue(name, { connection: admin, prefix: PREFIX });
    await q.obliterate({ force: true });
    await q.close();
  }
}
beforeEach(async () => {
  await resetDb();
  await wipeQueue();
  alerts.length = 0;
});
afterEach(async () => {
  await worker?.stop();
  worker = undefined;
});
afterAll(async () => {
  await wipeQueue();
  admin.disconnect();
  await prisma.$disconnect();
});

const run = async (handlers: Record<string, EventHandler>) =>
  (worker = await startWorker({ redisUrl: REDIS_URL, handlers, alert: async (e) => void alerts.push(e), idlePollMs: 50, prefix: PREFIX, delivery: FAST }));
const emit = (type = "store.published", storeId: string | null = "s1") => prisma.$transaction((tx) => recordEvent({ tx }, { type, storeId, payload: { n: 1 } }));
async function until(cond: () => Promise<boolean> | boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition not met in time");
}

describe("worker: outbox -> queue -> consumer (real Valkey)", () => {
  it("delivers a committed event once to its consumer and stamps the outbox row", async () => {
    const seen: EventEnvelope[] = [];
    run({ "store.published": async (e) => void seen.push(e) });
    const { id } = await emit();
    await until(() => seen.length === 1);
    expect(seen[0]).toMatchObject({ id, type: "store.published", storeId: "s1", payload: { n: 1 } });
    await until(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).publishedAt !== null);
  });

  it("an event published twice (relay crashed before stamping) is delivered once: the job id is the event id", async () => {
    const seen: string[] = [];
    run({ "store.published": async (e) => void seen.push(e.id) });
    const { id } = await emit();
    await until(() => seen.length === 1);
    // simulate the crash window: un-stamp the row so the relay publishes it again
    await prisma.outboxEvent.update({ where: { id }, data: { publishedAt: null, availableAt: new Date(0) } });
    await until(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).publishedAt !== null);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual([id]);
  });

  it("a failing consumer is retried, and an alert is sent once all attempts are used", async () => {
    let calls = 0;
    run({ "store.published": async () => { calls += 1; throw new Error("consumer down"); } });
    await emit();
    await until(() => alerts.includes("event.dead"));
    expect(calls).toBe(FAST.attempts);
    expect(alerts.filter((a) => a === "event.dead")).toHaveLength(1);
  });

  it("a consumer that recovers within its attempts succeeds without an alert", async () => {
    let calls = 0;
    const done: string[] = [];
    run({ "store.published": async (e) => { calls += 1; if (calls === 1) throw new Error("transient"); done.push(e.id); } });
    await emit();
    await until(() => done.length === 1);
    expect(alerts).toEqual([]);
  });

  it("events written while the worker is down are delivered when it starts (nothing is lost)", async () => {
    await emit();
    await emit("store.published", "s2");
    const seen: string[] = [];
    run({ "store.published": async (e) => void seen.push(e.storeId!) });
    await until(() => seen.length === 2);
    expect(seen.sort()).toEqual(["s1", "s2"]);
  });
});

describe("worker: maintenance jobs on BullMQ Job Schedulers (phase 2.2b, real Valkey)", () => {
  it("runs each scheduled job repeatedly, never two at once, even with two worker processes", async () => {
    let running = 0;
    let maxRunning = 0;
    const runs: string[] = [];
    const maintenance = {
      jobs: [{ name: "job-a", everyMs: 150 }, { name: "job-b", everyMs: 150 }],
      run: async (name: string) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 120)); // longer than half the interval: overlaps would show up
        runs.push(name);
        running -= 1;
      },
    };
    const opts = { redisUrl: REDIS_URL, handlers: {}, alert: async () => undefined, idlePollMs: 50, prefix: PREFIX, delivery: FAST, maintenance };
    worker = await startWorker(opts);
    const second = await startWorker(opts); // a second worker process on the same queue
    try {
      await until(() => runs.filter((n) => n === "job-a").length >= 2 && runs.filter((n) => n === "job-b").length >= 2);
    } finally {
      await second.stop();
    }
    expect(maxRunning).toBe(1); // global concurrency 1 across both processes
  });

  it("a scheduler that is no longer in the job table is removed on start (a deleted job stops firing)", async () => {
    worker = await startWorker({ redisUrl: REDIS_URL, handlers: {}, alert: async () => undefined, prefix: PREFIX, delivery: FAST, maintenance: { jobs: [{ name: "old-job", everyMs: 60_000 }], run: async () => undefined } });
    await worker.stop();
    const seen: string[] = [];
    worker = await startWorker({ redisUrl: REDIS_URL, handlers: {}, alert: async () => undefined, prefix: PREFIX, delivery: FAST, maintenance: { jobs: [{ name: "new-job", everyMs: 60_000 }], run: async (n) => void seen.push(n) } });
    const q = new Queue("maintenance", { connection: admin, prefix: PREFIX });
    try {
      expect((await q.getJobSchedulers()).map((s) => s.key)).toEqual(["new-job"]);
    } finally {
      await q.close();
    }
  });
});
