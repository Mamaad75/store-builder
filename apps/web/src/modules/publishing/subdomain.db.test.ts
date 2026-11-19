import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteStore } from "@/modules/stores/service";
import { NotFoundError, ValidationError } from "@/modules/stores/errors";
import { createStore } from "@/modules/stores/service";
import { makeUser, prisma, resetDb } from "@/test/db-helpers";
import { draftRevisionOf, publishableStore } from "@/test/publish-helpers";
import { ConfirmationRequiredError, ReservedLabelLimitError, SubdomainReservedError, SubdomainTakenError } from "./errors";
import { publishStore, unpublishStore } from "./service";
import { claimSubdomain, getSubdomainState, isReservationActive } from "./subdomain";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const dayMs = 24 * 60 * 60 * 1000;
const reservation = (host: string) => prisma.subdomainReservation.findUnique({ where: { host } });
const domainOf = (storeId: string) => prisma.domain.findFirst({ where: { storeId, kind: "SUBDOMAIN" } });
async function bareStore(ownerId?: string) {
  const u = ownerId ? { id: ownerId } : await makeUser();
  const { id } = await createStore(u.id, { name: "x", templateKey: "general" });
  return { ownerId: u.id, storeId: id };
}
const raw = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

describe("claiming and changing a subdomain", () => {
  it("claims a label (lowercased), one per store; validation and reserved names are refused", async () => {
    const { ownerId, storeId } = await bareStore();
    expect(await claimSubdomain(ownerId, storeId, { label: " Coffee-Shop " })).toEqual({ label: "coffee-shop", changed: true });
    expect((await domainOf(storeId))?.host).toBe("coffee-shop");
    expect(await claimSubdomain(ownerId, storeId, { label: "coffee-shop" })).toEqual({ label: "coffee-shop", changed: false });
    for (const label of ["ab", "-bad", "has space", "UP_per", "admin", "www", "", 5, null]) {
      await expect(claimSubdomain(ownerId, storeId, { label }), String(label)).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await domainOf(storeId))?.host).toBe("coffee-shop");
  });

  it("a label held by another store is taken; tenants are isolated", async () => {
    const a = await bareStore();
    const b = await bareStore();
    await claimSubdomain(a.ownerId, a.storeId, { label: "mine-one" });
    await expect(claimSubdomain(b.ownerId, b.storeId, { label: "mine-one" })).rejects.toBeInstanceOf(SubdomainTakenError);
    await expect(claimSubdomain(b.ownerId, a.storeId, { label: "other-one" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await domainOf(a.storeId))?.host).toBe("mine-one");
  });

  it("changing the label releases the old one into a 30-day reservation, and a LIVE store needs confirmation", async () => {
    const { owner, storeId } = await publishableStore({ label: "first-name" });
    await publishStore(owner.id, storeId, { expectedDraftRevision: await draftRevisionOf(storeId) });
    await expect(claimSubdomain(owner.id, storeId, { label: "second-name" })).rejects.toBeInstanceOf(ConfirmationRequiredError);
    expect((await domainOf(storeId))?.host).toBe("first-name");
    await claimSubdomain(owner.id, storeId, { label: "second-name", confirmChange: true });
    expect((await domainOf(storeId))?.host).toBe("second-name");
    const r = await reservation("first-name");
    expect(r).toMatchObject({ previousStoreId: storeId, cause: "RELEASED" });
    expect(r!.reservedUntil.getTime() - r!.releasedAt.getTime()).toBe(30 * dayMs);
    const state = await getSubdomainState(owner.id, storeId);
    expect(state.current).toBe("second-name");
    expect(state.reserved.map((x) => x.host)).toEqual(["first-name"]);
  });

  it("an unpublished or draft store changes its label without confirmation", async () => {
    const { owner, storeId } = await publishableStore({ label: "draft-one" });
    await claimSubdomain(owner.id, storeId, { label: "draft-two" });
    await publishStore(owner.id, storeId, { expectedDraftRevision: await draftRevisionOf(storeId) });
    await unpublishStore(owner.id, storeId);
    await claimSubdomain(owner.id, storeId, { label: "draft-three" });
    expect((await domainOf(storeId))?.host).toBe("draft-three");
  });
});

describe("the 30-day reservation", () => {
  it("only the SAME store can reclaim a released label inside the window; everybody else is refused until it ends", async () => {
    const a = await bareStore();
    const b = await bareStore(a.ownerId); // even the same owner's other store
    await claimSubdomain(a.ownerId, a.storeId, { label: "old-label" });
    await claimSubdomain(a.ownerId, a.storeId, { label: "new-label" });
    const err = await raw(claimSubdomain(b.ownerId, b.storeId, { label: "old-label" }));
    expect(err).toBeInstanceOf(SubdomainReservedError);
    expect((err as SubdomainReservedError).until.getTime()).toBe((await reservation("old-label"))!.reservedUntil.getTime());
    expect(await domainOf(b.storeId)).toBeNull();
    // the same store takes it back; its current label is released and reserved in turn
    expect(await claimSubdomain(a.ownerId, a.storeId, { label: "old-label" })).toEqual({ label: "old-label", changed: true });
    expect(await reservation("old-label")).toBeNull();
    expect(await reservation("new-label")).not.toBeNull();
  });

  it("boundary: still reserved 1 µs before the end, available at exactly reservedUntil (same transaction => now() is constant)", async () => {
    const a = await bareStore();
    const b = await bareStore();
    // pure predicate
    const end = new Date("2026-01-31T00:00:00.000Z");
    expect(isReservationActive(end, new Date(end.getTime() - 1))).toBe(true);
    expect(isReservationActive(end, end)).toBe(false);
    expect(isReservationActive(end, new Date(end.getTime() + 1))).toBe(false);
    // database: inside ONE transaction now() is constant, so reservedUntil = now() is the exact boundary
    const attempt = (offset: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO "SubdomainReservation" ("host","previousStoreId","cause","releasedAt","reservedUntil") VALUES ('edge-label', '${a.storeId}', 'RELEASED', now() - interval '30 days', now() ${offset})`);
        await tx.domain.create({ data: { storeId: b.storeId, kind: "SUBDOMAIN", host: "edge-label", verifiedAt: new Date() } });
      });
    const before = await raw(attempt("+ interval '1 microsecond'"));
    expect(String(before?.message)).toContain("SUBDOMAIN_RESERVED");
    expect(await domainOf(b.storeId)).toBeNull();
    expect(await attempt("")).toBeUndefined(); // exactly at the end: free, and the expired row is removed by the claim
    expect((await domainOf(b.storeId))?.host).toBe("edge-label");
    expect(await reservation("edge-label")).toBeNull();
  });

  it("timeline: 29 days 23 h 59 min 59 s after the release the label is still held, 30 days after it is free", async () => {
    const a = await bareStore();
    const b = await bareStore();
    await claimSubdomain(a.ownerId, a.storeId, { label: "timed-label" });
    await claimSubdomain(a.ownerId, a.storeId, { label: "timed-next" });
    const shift = (seconds: number) => prisma.$executeRawUnsafe(`UPDATE "SubdomainReservation" SET "releasedAt" = now() - interval '${seconds} seconds' - interval '30 days' + interval '1 second' * ${30 * 86400}, "reservedUntil" = now() - interval '${seconds} seconds' - interval '30 days' + interval '30 days' + interval '1 second' * ${30 * 86400} WHERE host = 'timed-label'`);
    // released 29d23h59m59s ago => reservedUntil = now() + 1 s
    await prisma.$executeRawUnsafe(`UPDATE "SubdomainReservation" SET "releasedAt" = now() - interval '29 days 23 hours 59 minutes 59 seconds', "reservedUntil" = now() + interval '1 second' WHERE host = 'timed-label'`);
    await expect(claimSubdomain(b.ownerId, b.storeId, { label: "timed-label" })).rejects.toBeInstanceOf(SubdomainReservedError);
    await prisma.$executeRawUnsafe(`UPDATE "SubdomainReservation" SET "releasedAt" = now() - interval '30 days 1 second', "reservedUntil" = now() - interval '1 second' WHERE host = 'timed-label'`);
    expect(await claimSubdomain(b.ownerId, b.storeId, { label: "timed-label" })).toEqual({ label: "timed-label", changed: true });
    void shift;
  });

  it("a store holds at most 3 released-but-reserved labels; reclaiming one of its own is still possible", async () => {
    const { ownerId, storeId } = await bareStore();
    for (const l of ["label-a", "label-b", "label-c", "label-d"]) await claimSubdomain(ownerId, storeId, { label: l }); // releases a, b, c
    expect((await getSubdomainState(ownerId, storeId)).reserved.map((r) => r.host).sort()).toEqual(["label-a", "label-b", "label-c"]);
    const err = await raw(claimSubdomain(ownerId, storeId, { label: "label-e" }));
    expect(err).toBeInstanceOf(ReservedLabelLimitError);
    expect((await domainOf(storeId))?.host).toBe("label-d"); // refused: nothing changed
    await claimSubdomain(ownerId, storeId, { label: "label-a" }); // reclaim of its own label frees a slot and takes one
    expect((await domainOf(storeId))?.host).toBe("label-a");
    expect((await getSubdomainState(ownerId, storeId)).reserved).toHaveLength(3);
  });

  it("a released label never serves content (it has no Domain row), and a reserved label cannot be inserted by any other store even with raw SQL", async () => {
    const a = await bareStore();
    const b = await bareStore();
    await claimSubdomain(a.ownerId, a.storeId, { label: "gone-label" });
    await claimSubdomain(a.ownerId, a.storeId, { label: "kept-label" });
    expect(await prisma.domain.count({ where: { host: "gone-label" } })).toBe(0);
    const e = await raw(prisma.$executeRaw`INSERT INTO "Domain" ("id","storeId","kind","host","verifiedAt") VALUES ('rawd1', ${b.storeId}, 'SUBDOMAIN', 'gone-label', now())`);
    expect(String(e?.message)).toContain("SUBDOMAIN_RESERVED");
  });
});

describe("store deletion: the tombstone is independent of the cascade", () => {
  it("deleting a store (service) cascades everything, keeps a 30-day STORE_DELETED tombstone, and nobody can claim the label", async () => {
    const { owner, storeId, label } = await publishableStore({ label: "doomed-shop", products: 2 });
    await publishStore(owner.id, storeId, { expectedDraftRevision: await draftRevisionOf(storeId) });
    expect(await prisma.storeVersionProduct.count()).toBe(2);
    expect(await prisma.publishedSlug.count()).toBe(2);
    await deleteStore(owner.id, storeId, "فروشگاه");
    expect(await prisma.store.count()).toBe(0);
    expect(await prisma.storeVersion.count()).toBe(0);
    expect(await prisma.storeVersionProduct.count()).toBe(0);
    expect(await prisma.publishedSlug.count()).toBe(0);
    expect(await prisma.domain.count()).toBe(0);
    const r = await reservation(label);
    expect(r).toMatchObject({ previousStoreId: storeId, cause: "STORE_DELETED" });
    expect(r!.reservedUntil.getTime() - r!.releasedAt.getTime()).toBe(30 * dayMs);
    const other = await bareStore(owner.id);
    await expect(claimSubdomain(owner.id, other.storeId, { label })).rejects.toBeInstanceOf(SubdomainReservedError); // not even the owner's other store
    const stranger = await bareStore();
    await expect(claimSubdomain(stranger.ownerId, stranger.storeId, { label })).rejects.toBeInstanceOf(SubdomainReservedError);
  });

  it("a raw DELETE of the store gives the same result, and cause labels are RELEASED for a Domain delete and STORE_DELETED for a cascade (observed PostgreSQL behaviour; no rule reads the cause)", async () => {
    const a = await publishableStore({ label: "raw-store-a", products: 0 });
    const b = await publishableStore({ label: "raw-store-b", products: 0 });
    await prisma.$executeRaw`DELETE FROM "Domain" WHERE host = 'raw-store-a'`;
    await prisma.$executeRaw`DELETE FROM "Store" WHERE id = ${b.storeId}`;
    expect((await reservation("raw-store-a"))?.cause).toBe("RELEASED");
    expect((await reservation("raw-store-b"))?.cause).toBe("STORE_DELETED");
    expect(await prisma.store.findUnique({ where: { id: a.storeId } })).not.toBeNull();
  });

  it("ATOMIC: if creating the tombstone fails, the whole store deletion rolls back (store, versions, slugs, domain all remain)", async () => {
    const { owner, storeId, label } = await publishableStore({ label: "atomic-shop", products: 1 });
    await publishStore(owner.id, storeId, { expectedDraftRevision: await draftRevisionOf(storeId) });
    const counts = async () => JSON.stringify([await prisma.store.count(), await prisma.storeVersion.count(), await prisma.storeVersionProduct.count(), await prisma.publishedSlug.count(), await prisma.domain.count(), await prisma.product.count()]);
    const before = await counts();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_fail_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'tombstone failure injected'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_fail_tombstone_trg BEFORE INSERT ON "SubdomainReservation" FOR EACH ROW EXECUTE FUNCTION test_fail_tombstone()`);
    try {
      await expect(deleteStore(owner.id, storeId, "فروشگاه")).rejects.toThrow();
      expect(await counts()).toBe(before);
      expect(await reservation(label)).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER test_fail_tombstone_trg ON "SubdomainReservation"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION test_fail_tombstone()`);
    }
    await deleteStore(owner.id, storeId, "فروشگاه"); // with the fault removed, the deletion works
    expect(await prisma.store.count()).toBe(0);
    expect((await reservation(label))?.cause).toBe("STORE_DELETED");
  });
});

describe("Domain UPDATE cannot bypass reservation or host isolation", () => {
  it("the identity fields (id, storeId, kind, host) are immutable; a label can only move by release + claim", async () => {
    const a = await bareStore();
    const b = await bareStore();
    await claimSubdomain(a.ownerId, a.storeId, { label: "fixed-label" });
    const d = (await domainOf(a.storeId))!;
    const mustFail = async (sql: Promise<unknown>) => expect(String((await raw(sql))?.message)).toContain("DOMAIN_IDENTITY_IMMUTABLE");
    await mustFail(prisma.$executeRaw`UPDATE "Domain" SET host = 'other-label' WHERE id = ${d.id}`);
    await mustFail(prisma.$executeRaw`UPDATE "Domain" SET "storeId" = ${b.storeId} WHERE id = ${d.id}`);
    await mustFail(prisma.$executeRaw`UPDATE "Domain" SET kind = 'CUSTOM' WHERE id = ${d.id}`);
    await mustFail(prisma.$executeRaw`UPDATE "Domain" SET id = 'newid' WHERE id = ${d.id}`);
    await mustFail(prisma.domain.update({ where: { id: d.id }, data: { host: "prisma-update" } }));
    expect(await domainOf(a.storeId)).toMatchObject({ host: "fixed-label" });
  });

  it("an UPDATE cannot take over a RESERVED label, steal another store's label, or hop a label to another store", async () => {
    const a = await bareStore();
    const b = await bareStore();
    await claimSubdomain(a.ownerId, a.storeId, { label: "kept-name" });
    await claimSubdomain(a.ownerId, a.storeId, { label: "swap-name" }); // kept-name is now reserved for store a
    await claimSubdomain(b.ownerId, b.storeId, { label: "b-label" });
    const bd = (await domainOf(b.storeId))!;
    const fail = (e: Error | null) => expect(String(e?.message)).toContain("DOMAIN_IDENTITY_IMMUTABLE");
    fail(await raw(prisma.$executeRaw`UPDATE "Domain" SET host = 'kept-name' WHERE id = ${bd.id}`)); // reserved label
    fail(await raw(prisma.$executeRaw`UPDATE "Domain" SET host = 'swap-name' WHERE id = ${bd.id}`)); // someone else's live label
    // upsert path: INSERT ... ON CONFLICT DO UPDATE reaches the UPDATE trigger (and the INSERT trigger runs first)
    const up = await raw(prisma.$executeRaw`INSERT INTO "Domain" (id, "storeId", kind, host, "verifiedAt") VALUES ('upsert1', ${b.storeId}, 'SUBDOMAIN', 'swap-name', now()) ON CONFLICT (kind, host) DO UPDATE SET "storeId" = EXCLUDED."storeId"`);
    expect(up).not.toBeNull();
    expect((await domainOf(a.storeId))?.host).toBe("swap-name");
    expect((await domainOf(b.storeId))?.host).toBe("b-label");
    expect(await reservation("kept-name")).not.toBeNull();
  });

  it("allowed updates (verifiedAt) still work, and updating without touching identity is fine", async () => {
    const a = await bareStore();
    await claimSubdomain(a.ownerId, a.storeId, { label: "plain-one" });
    const d = (await domainOf(a.storeId))!;
    const when = new Date("2026-02-02T00:00:00Z");
    await prisma.domain.update({ where: { id: d.id }, data: { verifiedAt: when } });
    expect((await domainOf(a.storeId))?.verifiedAt?.toISOString()).toBe(when.toISOString());
  });

  it("a CUSTOM domain is not affected by the subdomain rules (host isolation applies to SUBDOMAIN rows only)", async () => {
    const a = await bareStore();
    await prisma.domain.create({ data: { storeId: a.storeId, kind: "CUSTOM", host: "www.example.ir" } });
    await prisma.$executeRaw`DELETE FROM "Domain" WHERE host = 'www.example.ir'`;
    expect(await prisma.subdomainReservation.count()).toBe(0);
  });
});
