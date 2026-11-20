import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setMediaStorageForTests } from "../../lib/storage/index.js";
import { setPublishHooksForTests } from "../../modules/publishing/constants.js";
import { publishStore } from "../../modules/publishing/service.js";
import { prisma, resetDb } from "../../test/db-helpers.js";
import { MemoryMediaStorage } from "../../test/memory-storage.js";
import { draftRevisionOf, publishableStore } from "../../test/publish-helpers.js";
import { InvalidEventError, recordEvent } from "./outbox.js";
import { PrismaOutboxStore } from "./prisma-outbox.store.js";

beforeEach(async () => {
  await resetDb();
  setMediaStorageForTests(new MemoryMediaStorage());
});
afterEach(() => {
  setPublishHooksForTests({});
  setMediaStorageForTests(undefined);
});
afterAll(() => prisma.$disconnect());

const store = new PrismaOutboxStore();
const insert = (n: number, type = "store.published") =>
  prisma.$transaction(async (tx) => {
    for (let i = 0; i < n; i++) await recordEvent({ tx }, { type, storeId: "s1", payload: { i } });
  });
const outbox = () => prisma.outboxEvent.findMany({ orderBy: { occurredAt: "asc" } });

describe("outbox: write side", () => {
  it("the event commits with its transaction and disappears with a rollback", async () => {
    await insert(1);
    await prisma
      .$transaction(async (tx) => {
        await recordEvent({ tx }, { type: "store.published", storeId: "s1", payload: {} });
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it("rejects a malformed type in code, and the database CHECK rejects it too", async () => {
    await expect(prisma.$transaction((tx) => recordEvent({ tx }, { type: "Store Published", storeId: null, payload: {} }))).rejects.toBeInstanceOf(InvalidEventError);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "OutboxEvent"("id","type","payload") VALUES ('x','nodot','{}')`)).rejects.toThrow(/OutboxEvent_type_format/);
    await expect(prisma.$transaction((tx) => recordEvent({ tx }, { type: "a.b", storeId: null, payload: { big: "x".repeat(9_000) } }))).rejects.toBeInstanceOf(InvalidEventError);
  });

  it("a successful publish records exactly one store.published event; a failed publish records none", async () => {
    const s = await publishableStore({ products: 1 });
    setPublishHooksForTests({ beforeStep: async (name) => { if (name === "deferred-work") throw new Error("injected"); } });
    await expect(publishStore(s.owner.id, s.storeId, { expectedDraftRevision: await draftRevisionOf(s.storeId) })).rejects.toThrow();
    expect(await prisma.outboxEvent.count()).toBe(0);

    setPublishHooksForTests({});
    const r = await publishStore(s.owner.id, s.storeId, { expectedDraftRevision: await draftRevisionOf(s.storeId) });
    const events = await outbox();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "store.published", storeId: s.storeId, payload: { versionId: r.versionId, number: r.number }, publishedAt: null, attempts: 0 });
  });
});

describe("outbox: relay side (claims, leases, retries)", () => {
  it("claims due events once: a claimed event is leased and invisible to a second claim", async () => {
    await insert(3);
    const first = await store.claim(10, 60_000);
    expect(first).toHaveLength(3);
    expect(first.every((e) => e.attempts === 1)).toBe(true);
    expect(await store.claim(10, 60_000)).toEqual([]);
  });

  it("two relays claiming at the same time never get the same event (FOR UPDATE SKIP LOCKED)", async () => {
    await insert(40);
    const [a, b] = await Promise.all([store.claim(25, 60_000), store.claim(25, 60_000)]);
    const ids = [...a, ...b].map((e) => e.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
  });

  it("an expired lease (crashed relay) makes the event claimable again, with attempts counted", async () => {
    await insert(1);
    await store.claim(10, 1);
    await new Promise((r) => setTimeout(r, 20));
    const again = await store.claim(10, 60_000);
    expect(again.map((e) => e.attempts)).toEqual([2]);
  });

  it("published events are never claimed again; a failure is retried after its backoff with the reason stored", async () => {
    await insert(2);
    const [a, b] = await store.claim(10, 60_000);
    await store.markPublished(a!.id);
    await store.markFailed(b!.id, 1, "publish_failed:Error");
    await new Promise((r) => setTimeout(r, 20));
    const again = await store.claim(10, 60_000);
    expect(again.map((e) => e.id)).toEqual([b!.id]);
    const rows = await outbox();
    expect(rows.find((r) => r.id === a!.id)!.publishedAt).not.toBeNull();
    expect(rows.find((r) => r.id === b!.id)!.lastError).toBe("publish_failed:Error");
    // stamping twice is harmless, and a published event cannot be "failed" afterwards
    await store.markPublished(a!.id);
    await store.markFailed(a!.id, 1, "late");
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: a!.id } })).lastError).toBeNull();
  });
});
