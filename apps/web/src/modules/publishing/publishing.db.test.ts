import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalize } from "./canonical";
import { setPublishHooksForTests, setPublishLimitsForTests } from "./constants";
import { ConflictError, NotFoundError } from "@/modules/stores/errors";
import { updateProduct } from "@/modules/products/service";
import { getDraftPreview } from "@/modules/storefront/service";
import { draftRevisionOf, publishableStore } from "@/test/publish-helpers";
import { prisma, resetDb } from "@/test/db-helpers";
import { NoChangesError, StoreAlreadyLiveError, StoreNotLiveError, SubdomainRequiredError, VersionAlreadyLiveError } from "./errors";
import { getPublishState, listVersions, publishStore, setLiveVersion, unpublishStore } from "./service";

beforeEach(resetDb);
afterEach(() => {
  setPublishLimitsForTests({});
  setPublishHooksForTests({});
});
afterAll(() => prisma.$disconnect());

const publish = async (owner: string, store: string) => publishStore(owner, store, { expectedDraftRevision: await draftRevisionOf(store) });
const storeRow = (id: string) => prisma.store.findUniqueOrThrow({ where: { id } });
const rename = (owner: string, store: string, productId: string, name: string) => updateProduct(owner, store, productId, { name });

describe("publishing: the first publish", () => {
  it("creates version 1 from the draft, makes the store PUBLISHED, and does NOT bump draftRevision", async () => {
    const { owner, storeId, productIds } = await publishableStore();
    const rev = await draftRevisionOf(storeId);
    const r = await publish(owner.id, storeId);
    expect(r).toMatchObject({ number: 1, draftRevision: rev });
    expect(await draftRevisionOf(storeId)).toBe(rev); // publication is not a draft-content mutation
    const s = await storeRow(storeId);
    expect(s).toMatchObject({ status: "PUBLISHED", publishedVersionId: r.versionId });
    expect(s.publishedAt).not.toBeNull();
    const v = await prisma.storeVersion.findUniqueOrThrow({ where: { id: r.versionId } });
    expect(v).toMatchObject({ number: 1, draftRevision: rev });
    const idx = await prisma.storeVersionProduct.findMany({ where: { versionId: r.versionId } });
    expect(idx.map((p) => p.productId).sort()).toEqual([...productIds].sort());
    expect(await prisma.publishedSlug.count({ where: { storeId } })).toBe(productIds.length);
  });

  it("the snapshot is exactly what the draft preview shows (same builder, one consistent state)", async () => {
    const { owner, storeId } = await publishableStore();
    const preview = (await getDraftPreview(owner.id, storeId)).data;
    const r = await publish(owner.id, storeId);
    const v = await prisma.storeVersion.findUniqueOrThrow({ where: { id: r.versionId } });
    expect(canonicalize(v.snapshot)).toBe(canonicalize(preview));
  });

  it("contentHash and snapshotBytes describe the canonical input text (not JSONB's physical form), and the stored value re-canonicalises to the same hash", async () => {
    const { owner, storeId } = await publishableStore();
    const r = await publish(owner.id, storeId);
    const v = await prisma.storeVersion.findUniqueOrThrow({ where: { id: r.versionId } });
    const text = canonicalize(v.snapshot);
    expect(v.contentHash).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    expect(v.snapshotBytes).toBe(Buffer.byteLength(text, "utf8"));
    const stored = (await prisma.$queryRaw<{ stored: number }[]>`SELECT pg_column_size("snapshot")::int AS stored FROM "StoreVersion" WHERE id = ${r.versionId}`)[0]!.stored;
    expect(stored).not.toBe(v.snapshotBytes); // JSONB keeps a normalised binary form: never claimed to be the same size
  });

  it("requires a claimed subdomain", async () => {
    const { owner, storeId } = await publishableStore();
    await prisma.domain.deleteMany({ where: { storeId } });
    await expect(publish(owner.id, storeId)).rejects.toBeInstanceOf(SubdomainRequiredError);
    expect(await prisma.storeVersion.count()).toBe(0);
  });

  it("a stale expected revision is a ConflictError and writes nothing", async () => {
    const { owner, storeId, productIds } = await publishableStore();
    const rev = await draftRevisionOf(storeId);
    await rename(owner.id, storeId, productIds[0]!, "نام تازه"); // draft edited after the owner looked
    await expect(publishStore(owner.id, storeId, { expectedDraftRevision: rev })).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.storeVersion.count()).toBe(0);
    expect((await storeRow(storeId)).status).toBe("DRAFT");
  });

  it("another tenant's or a missing store looks identical (NotFoundError)", async () => {
    const a = await publishableStore();
    const b = await publishableStore();
    await expect(publishStore(b.owner.id, a.storeId, { expectedDraftRevision: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(publishStore(a.owner.id, "cmissing0000000000000000000", { expectedDraftRevision: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(unpublishStore(b.owner.id, a.storeId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.storeVersion.count()).toBe(0);
  });
});

describe("no-op detection compares with the ACTIVE snapshot, never the highest version", () => {
  it("identical to the live version -> NoChangesError, nothing written", async () => {
    const { owner, storeId } = await publishableStore();
    await publish(owner.id, storeId);
    await expect(publish(owner.id, storeId)).rejects.toBeInstanceOf(NoChangesError);
    expect(await prisma.storeVersion.count({ where: { storeId } })).toBe(1);
  });

  it("version 1 = A, version 2 = B, rollback to 1, draft = B: publishing is ALLOWED and creates version 3 (MAX + 1)", async () => {
    const { owner, storeId, productIds } = await publishableStore();
    await publish(owner.id, storeId); // v1 = A
    await rename(owner.id, storeId, productIds[0]!, "نسخهٔ B");
    const v2 = await publish(owner.id, storeId); // v2 = B
    expect(v2.number).toBe(2);
    await setLiveVersion(owner.id, storeId, { versionNumber: 1, mode: "rollback" }); // live = A, draft = B
    const v3 = await publish(owner.id, storeId); // draft (B) differs from the ACTIVE snapshot (A)
    expect(v3.number).toBe(3);
    expect((await storeRow(storeId)).publishedVersionId).toBe(v3.versionId);
    expect(await prisma.storeVersion.count({ where: { storeId } })).toBe(3);
  });

  it("an unpublished store has no active snapshot: publishing is always allowed, even for content identical to its last live version", async () => {
    const { owner, storeId } = await publishableStore();
    await publish(owner.id, storeId);
    await unpublishStore(owner.id, storeId);
    const again = await publish(owner.id, storeId);
    expect(again.number).toBe(2);
    expect((await storeRow(storeId)).status).toBe("PUBLISHED");
  });
});

describe("versions, rollback, republish and unpublish", () => {
  it("numbers are monotonic and unique, rollback never changes any version row, and a newer publish still works", async () => {
    const { owner, storeId, productIds } = await publishableStore();
    const before: string[] = [];
    for (let i = 1; i <= 3; i++) {
      await rename(owner.id, storeId, productIds[0]!, `اسم ${i}`);
      await publish(owner.id, storeId);
    }
    const rows = async () => JSON.stringify(await prisma.$queryRaw`SELECT * FROM "StoreVersion" WHERE "storeId" = ${storeId} ORDER BY number`);
    before.push(await rows());
    await setLiveVersion(owner.id, storeId, { versionNumber: 1, mode: "rollback" });
    await setLiveVersion(owner.id, storeId, { versionNumber: 3, mode: "rollback" }); // roll forward
    await setLiveVersion(owner.id, storeId, { versionNumber: 2, mode: "rollback" });
    expect(await rows()).toBe(before[0]); // not a byte of any version changed
    await rename(owner.id, storeId, productIds[0]!, "اسم ۴");
    expect((await publish(owner.id, storeId)).number).toBe(4); // after rolling back, a newer version is still possible
    expect((await listVersions(owner.id, storeId)).map((v) => v.number)).toEqual([4, 3, 2, 1]);
  });

  it("rollback needs a live store and a different version; republish needs an offline store; unpublish keeps every version", async () => {
    const { owner, storeId, productIds } = await publishableStore();
    await publish(owner.id, storeId);
    await rename(owner.id, storeId, productIds[0]!, "دوم");
    await publish(owner.id, storeId);
    await expect(setLiveVersion(owner.id, storeId, { versionNumber: 2, mode: "rollback" })).rejects.toBeInstanceOf(VersionAlreadyLiveError);
    await expect(setLiveVersion(owner.id, storeId, { versionNumber: 1, mode: "republish" })).rejects.toBeInstanceOf(StoreAlreadyLiveError);
    await expect(setLiveVersion(owner.id, storeId, { versionNumber: 99, mode: "rollback" })).rejects.toBeInstanceOf(NotFoundError);
    await unpublishStore(owner.id, storeId);
    expect(await storeRow(storeId)).toMatchObject({ status: "UNPUBLISHED", publishedVersionId: null });
    expect(await prisma.storeVersion.count({ where: { storeId } })).toBe(2);
    await expect(unpublishStore(owner.id, storeId)).rejects.toBeInstanceOf(StoreNotLiveError);
    await expect(setLiveVersion(owner.id, storeId, { versionNumber: 1, mode: "rollback" })).rejects.toBeInstanceOf(StoreNotLiveError); // rollback of an offline store is refused
    expect((await setLiveVersion(owner.id, storeId, { versionNumber: 1, mode: "republish" })).number).toBe(1);
    expect(await storeRow(storeId)).toMatchObject({ status: "PUBLISHED" });
    expect((await getPublishState(owner.id, storeId)).live?.number).toBe(1);
  });

  it("republish also needs a claimed subdomain", async () => {
    const { owner, storeId } = await publishableStore();
    await publish(owner.id, storeId);
    await unpublishStore(owner.id, storeId);
    await prisma.domain.deleteMany({ where: { storeId } });
    await expect(setLiveVersion(owner.id, storeId, { versionNumber: 1, mode: "republish" })).rejects.toBeInstanceOf(SubdomainRequiredError);
  });
});
