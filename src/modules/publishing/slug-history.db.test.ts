import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProduct, deleteProduct, updateProduct, changeProductStatus } from "@/modules/products/service";
import { validProduct } from "@/test/catalog-helpers";
import { prisma, resetDb } from "@/test/db-helpers";
import { draftRevisionOf, publishableStore } from "@/test/publish-helpers";
import { setPublishHooksForTests, setPublishLimitsForTests } from "./constants";
import { resolveProductRedirect, resolveLiveStore } from "./public-read";
import { publishStore, setLiveVersion, unpublishStore } from "./service";
import { ValidationError } from "@/modules/stores/errors";

beforeEach(resetDb);
afterEach(() => {
  setPublishLimitsForTests({});
  setPublishHooksForTests({});
});
afterAll(() => prisma.$disconnect());

const publish = async (o: string, s: string) => publishStore(o, s, { expectedDraftRevision: await draftRevisionOf(s) });
const redirect = (label: string, slug: string) => resolveProductRedirect(label, slug);
async function setup() {
  const s = await publishableStore({ products: 1 });
  const pid = s.productIds[0]!;
  const rename = (slug: string) => updateProduct(s.owner.id, s.storeId, pid, { slug, confirmSlugChange: true });
  const slugNow = async () => (await prisma.product.findUniqueOrThrow({ where: { id: pid } })).slug;
  return { ...s, pid, rename, slugNow };
}

describe("historical slugs resolve directly to the CURRENT slug of the ACTIVE snapshot", () => {
  it("rename + publish: the old slug redirects, the current one does not", async () => {
    const t = await setup();
    const a = await t.slugNow();
    await publish(t.owner.id, t.storeId); // v1 = a
    await t.rename("slug-b");
    await publish(t.owner.id, t.storeId); // v2 = b
    expect(await redirect(t.label, a)).toBe("slug-b");
    expect(await redirect(t.label, "slug-b")).toBeNull();
    expect(await redirect(t.label, "never-existed")).toBeNull();
  });

  it("ROLLBACK: after rolling back to version 1, the later slug 'b' redirects to 'a' and 'a' no longer redirects", async () => {
    const t = await setup();
    const a = await t.slugNow();
    await publish(t.owner.id, t.storeId);
    await t.rename("slug-b");
    await publish(t.owner.id, t.storeId);
    await setLiveVersion(t.owner.id, t.storeId, { versionNumber: 1, mode: "rollback" });
    expect(await redirect(t.label, "slug-b")).toBe(a);
    expect(await redirect(t.label, a)).toBeNull();
    await setLiveVersion(t.owner.id, t.storeId, { versionNumber: 2, mode: "rollback" }); // roll forward
    expect(await redirect(t.label, a)).toBe("slug-b");
    expect(await redirect(t.label, "slug-b")).toBeNull();
  });

  it("multiple renames, publishes, rollbacks and republish of an older version: every old slug goes DIRECTLY to the slug of the live version (never a chain)", async () => {
    const t = await setup();
    const a = await t.slugNow();
    await publish(t.owner.id, t.storeId); // v1 = a
    await t.rename("slug-b");
    await publish(t.owner.id, t.storeId); // v2 = b
    await t.rename("slug-c");
    await publish(t.owner.id, t.storeId); // v3 = c
    expect([await redirect(t.label, a), await redirect(t.label, "slug-b"), await redirect(t.label, "slug-c")]).toEqual(["slug-c", "slug-c", null]);
    await setLiveVersion(t.owner.id, t.storeId, { versionNumber: 2, mode: "rollback" });
    expect([await redirect(t.label, a), await redirect(t.label, "slug-b"), await redirect(t.label, "slug-c")]).toEqual(["slug-b", null, "slug-b"]);
    await unpublishStore(t.owner.id, t.storeId);
    expect(await redirect(t.label, a)).toBeNull(); // not live: nothing resolves
    await setLiveVersion(t.owner.id, t.storeId, { versionNumber: 1, mode: "republish" });
    expect([await redirect(t.label, a), await redirect(t.label, "slug-b"), await redirect(t.label, "slug-c")]).toEqual([null, a, a]);
  });

  it("a product absent from the active snapshot (deleted, archived or draft) returns 404, and its slugs stay reserved", async () => {
    const t = await setup();
    const a = await t.slugNow();
    await publish(t.owner.id, t.storeId); // v1 has the product
    await t.rename("slug-b");
    await publish(t.owner.id, t.storeId); // v2 = b
    await changeProductStatus(t.owner.id, t.storeId, t.pid, "ARCHIVED");
    const keep = await createProduct(t.owner.id, t.storeId, validProduct({ name: "ماندگار" }));
    await changeProductStatus(t.owner.id, t.storeId, keep.id, "ACTIVE");
    await publish(t.owner.id, t.storeId); // v3 without the archived product
    expect(await redirect(t.label, a)).toBeNull();
    expect(await redirect(t.label, "slug-b")).toBeNull();
    await deleteProduct(t.owner.id, t.storeId, t.pid);
    await changeProductStatus(t.owner.id, t.storeId, keep.id, "DRAFT").then(() => changeProductStatus(t.owner.id, t.storeId, keep.id, "ACTIVE"));
    // reserved even though the product is gone
    await expect(createProduct(t.owner.id, t.storeId, validProduct({ name: "جدید", slug: a }))).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProduct(t.owner.id, t.storeId, keep.id, { slug: "slug-b" })).rejects.toBeInstanceOf(ValidationError);
    // rolling back to version 2 makes the deleted product live again in the PUBLIC snapshot: its old slug redirects to the snapshot's slug
    await setLiveVersion(t.owner.id, t.storeId, { versionNumber: 2, mode: "rollback" });
    expect(await redirect(t.label, a)).toBe("slug-b");
  });
});

describe("slug reservation and collisions (scoped to the store)", () => {
  it("another product cannot take a published slug; generated slugs skip reserved ones; the product itself may return to an old slug", async () => {
    const t = await setup();
    const a = await t.slugNow();
    await publish(t.owner.id, t.storeId);
    await t.rename("slug-b");
    await publish(t.owner.id, t.storeId);
    const other = await createProduct(t.owner.id, t.storeId, validProduct({ name: "محصول دیگر" }));
    const e = await updateProduct(t.owner.id, t.storeId, other.id, { slug: a }).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(Object.values((e as ValidationError).fieldErrors).flat().join(" ")).toContain("رزرو");
    const gen = await createProduct(t.owner.id, t.storeId, validProduct({ name: "محصول ۱", slug: undefined }));
    expect(gen.slug).not.toBe(a); // generated slugs avoid reserved ones
    await t.rename(a); // returning to its own earlier slug is allowed
    expect(await t.slugNow()).toBe(a);
  });

  it("a slug reserved in one store does not affect another store (history is per store)", async () => {
    const t = await setup();
    const a = await t.slugNow();
    await publish(t.owner.id, t.storeId);
    await t.rename("slug-b");
    await publish(t.owner.id, t.storeId);
    const other = await publishableStore({ products: 0 });
    const p = await createProduct(other.owner.id, other.storeId, validProduct({ name: "x", slug: a }));
    expect(p.slug).toBe(a);
    await changeProductStatus(other.owner.id, other.storeId, p.id, "ACTIVE");
    await publish(other.owner.id, other.storeId);
    expect(await redirect(other.label, a)).toBeNull(); // in the other store it is a CURRENT slug
    expect(await redirect(t.label, a)).toBe("slug-b");
    expect(await redirect(other.label, "slug-b")).toBeNull(); // not another tenant's history
  });

  it("the per-product limit is refused BEFORE it is exceeded, with a clear Persian message; returning to a published slug stays possible", async () => {
    const t = await setup();
    setPublishLimitsForTests({ maxPublishesPerHour: 1_000 });
    for (let i = 1; i <= 6; i++) {
      await t.rename(`slug-v${i}`);
      await publish(t.owner.id, t.storeId); // 6 published slugs: the maximum (current + 5 historical)
    }
    const e = await t.rename("slug-v7").then(() => null, (x) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(Object.values((e as ValidationError).fieldErrors).flat().join(" ")).toContain("بیش از ۵ آدرس قبلی");
    expect(await t.slugNow()).toBe("slug-v6"); // unchanged
    await t.rename("slug-v3"); // an already published slug is fine
    expect(await t.slugNow()).toBe("slug-v3");
  });
});

describe("model-based check: for any sequence of operations every historical slug is a 404 or ONE hop to a slug that renders", () => {
  function prng(seed: number) {
    let x = seed >>> 0;
    return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("random sequence (seed %i)", async (seed) => {
    const rnd = prng(seed * 7919);
    const t = await setup();
    setPublishLimitsForTests({ maxPublishesPerHour: 10_000 });
    const everUsed = new Set<string>([await t.slugNow()]);
    let n = 0;
    let versions = 0;
    let live = false;
    let pidAlive = true;
    for (let step = 0; step < 14; step++) {
      const r = rnd();
      try {
        if (r < 0.34 && pidAlive) {
          const slug = `s${seed}-${++n}`;
          await t.rename(slug);
          everUsed.add(slug);
        } else if (r < 0.62) {
          await publish(t.owner.id, t.storeId);
          versions++;
          live = true;
        } else if (r < 0.78 && versions > 0) {
          const target = 1 + Math.floor(rnd() * versions);
          await setLiveVersion(t.owner.id, t.storeId, { versionNumber: target, mode: live ? "rollback" : "republish" });
          live = true;
        } else if (r < 0.86 && live) {
          await unpublishStore(t.owner.id, t.storeId);
          live = false;
        } else if (r < 0.9 && pidAlive && versions > 0) {
          await changeProductStatus(t.owner.id, t.storeId, t.pid, "ARCHIVED");
          pidAlive = false;
        }
      } catch (e) {
        if (!(e instanceof Error) || !["VersionAlreadyLiveError", "NoChangesError", "ValidationError", "StoreNotLiveError", "StoreAlreadyLiveError", "ConflictError"].includes(e.name)) throw e;
      }
      // invariants after EVERY step
      const liveRow = await prisma.store.findUniqueOrThrow({ where: { id: t.storeId } });
      const inLive = liveRow.publishedVersionId ? await prisma.storeVersionProduct.findFirst({ where: { versionId: liveRow.publishedVersionId, productId: t.pid } }) : null;
      for (const slug of everUsed) {
        const to = await redirect(t.label, slug);
        if (!liveRow.publishedVersionId || !inLive) {
          expect(to, `${slug} (not live or product absent)`).toBeNull();
        } else if (slug === inLive.slug) {
          expect(to, `${slug} is current`).toBeNull();
        } else {
          const published = await prisma.publishedSlug.findFirst({ where: { storeId: t.storeId, slug } });
          if (published) {
            expect(to, `${slug} -> current`).toBe(inLive.slug); // direct to the active snapshot's slug
            expect(await redirect(t.label, to!), "no chain").toBeNull(); // the target renders
          } else {
            expect(to, `${slug} never published`).toBeNull();
          }
        }
      }
      expect((await resolveLiveStore(t.label) !== null)).toBe(!!liveRow.publishedVersionId);
    }
  }, 120_000);
});
