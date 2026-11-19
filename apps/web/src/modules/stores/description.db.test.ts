import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NoChangesError } from "@/modules/publishing/errors";
import { loadPublishedSnapshot, resolveLiveStore } from "@/modules/publishing/public-read";
import { publishStore } from "@/modules/publishing/service";
import { prisma, resetDb } from "@/test/db-helpers";
import { draftRevisionOf, publishableStore } from "@/test/publish-helpers";
import { ValidationError } from "./errors";
import { updateStore } from "./service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const publish = async (owner: string, store: string) => publishStore(owner, store, { expectedDraftRevision: await draftRevisionOf(store) });
const settingsOf = async (storeId: string) => (await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).settings as Record<string, unknown>;
const snapshotOf = async (versionId: string) => (await prisma.storeVersion.findUniqueOrThrow({ where: { id: versionId } })).snapshot as { store: Record<string, unknown> };

describe("store description (phase 11): settings", () => {
  it("is saved trimmed with whitespace collapsed, can be changed, and is cleared by an empty save", async () => {
    const s = await publishableStore({ products: 1 });
    await updateStore(s.owner.id, s.storeId, { description: "  فروشگاه \n\n چای   و قهوه  " });
    expect((await settingsOf(s.storeId)).description).toBe("فروشگاه چای و قهوه");
    await updateStore(s.owner.id, s.storeId, { description: "متن تازه" });
    expect((await settingsOf(s.storeId)).description).toBe("متن تازه");
    await updateStore(s.owner.id, s.storeId, { description: "" });
    expect((await settingsOf(s.storeId)).description).toBe("");
  });

  it("is limited to 160 characters and refuses control characters, with nothing saved", async () => {
    const s = await publishableStore({ products: 1 });
    const rev = await draftRevisionOf(s.storeId);
    await expect(updateStore(s.owner.id, s.storeId, { description: "x".repeat(161) })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateStore(s.owner.id, s.storeId, { description: "bad\u0000text" })).rejects.toBeInstanceOf(ValidationError);
    await updateStore(s.owner.id, s.storeId, { description: "x".repeat(160) }); // exactly at the limit
    expect(await draftRevisionOf(s.storeId)).toBe(rev + 1);
  });

  it("an unrelated settings save (colour, appearance, contact) never wipes it", async () => {
    const s = await publishableStore({ products: 1 });
    await updateStore(s.owner.id, s.storeId, { description: "حفظ می‌شود" });
    await updateStore(s.owner.id, s.storeId, { primaryColor: "#112233" });
    await updateStore(s.owner.id, s.storeId, { typography: { sizeScale: "large" } });
    await updateStore(s.owner.id, s.storeId, { contact: { phone: "0211234" } });
    expect((await settingsOf(s.storeId)).description).toBe("حفظ می‌شود");
  });
});

describe("store description (phase 11): publishing", () => {
  it("a store that never set one publishes a snapshot WITHOUT the key, and re-publishing is still 'no changes' (no hash churn)", async () => {
    const s = await publishableStore({ products: 1 });
    const v1 = await publish(s.owner.id, s.storeId);
    expect("description" in (await snapshotOf(v1.versionId)).store).toBe(false);
    await expect(publish(s.owner.id, s.storeId)).rejects.toBeInstanceOf(NoChangesError);
    // saving an EMPTY description is not a change of the published content either
    await updateStore(s.owner.id, s.storeId, { description: "" });
    await expect(publish(s.owner.id, s.storeId)).rejects.toBeInstanceOf(NoChangesError);
  });

  it("a set description reaches the published snapshot, and clearing it removes the key again", async () => {
    const s = await publishableStore({ products: 1 });
    await publish(s.owner.id, s.storeId);
    await updateStore(s.owner.id, s.storeId, { description: "فروشگاه معتبر" });
    const v2 = await publish(s.owner.id, s.storeId);
    expect((await snapshotOf(v2.versionId)).store.description).toBe("فروشگاه معتبر");
    const loaded = await loadPublishedSnapshot(v2.versionId);
    expect(loaded?.store.description).toBe("فروشگاه معتبر");
    await updateStore(s.owner.id, s.storeId, { description: "" });
    const v3 = await publish(s.owner.id, s.storeId);
    expect("description" in (await snapshotOf(v3.versionId)).store).toBe(false);
    // the earlier version is untouched (immutable)
    expect((await snapshotOf(v2.versionId)).store.description).toBe("فروشگاه معتبر");
  });

  it("draft edits after publishing do not change the live description", async () => {
    const s = await publishableStore({ products: 1 });
    await updateStore(s.owner.id, s.storeId, { description: "منتشرشده" });
    const v = await publish(s.owner.id, s.storeId);
    await updateStore(s.owner.id, s.storeId, { description: "فقط پیش‌نویس" });
    expect((await loadPublishedSnapshot(v.versionId))?.store.description).toBe("منتشرشده");
  });
});

describe("public read: liveSince (the sitemap lastmod)", () => {
  it("is the time the live version went live, and moves with a republish, not with draft edits", async () => {
    const s = await publishableStore({ products: 1 });
    expect(await resolveLiveStore(s.label)).toBeNull();
    const before = Date.now();
    await publish(s.owner.id, s.storeId);
    const live = await resolveLiveStore(s.label);
    expect(live?.liveSince).toBeInstanceOf(Date);
    expect(live!.liveSince.getTime()).toBeGreaterThanOrEqual(before - 2_000);
    expect(live!.liveSince.getTime()).toBeLessThanOrEqual(Date.now() + 2_000);
    await updateStore(s.owner.id, s.storeId, { name: "نام دیگر" }); // a draft edit
    expect((await resolveLiveStore(s.label))!.liveSince.getTime()).toBe(live!.liveSince.getTime());
  });
});
