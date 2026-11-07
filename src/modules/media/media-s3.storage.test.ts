import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getStorageConfig } from "@/lib/storage/config";
import { mediaPublicUrl, newMediaKey } from "@/lib/storage";
import { S3MediaStorage } from "@/lib/storage/s3";
import { prisma, resetDb } from "@/test/db-helpers";
import { twoTenants, validProduct } from "@/test/catalog-helpers";
import { MemoryRateLimiter } from "@/modules/auth/rate-limit";
import { createProduct } from "@/modules/products/service";
import { runMediaCleanup } from "./cleanup";
import { MediaStorageError } from "./errors";
import { attachProductImage, detachProductImage, uploadMedia } from "./service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const photo = () => sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 100, b: 20 } } }).jpeg().toBuffer();
const quiet = () => undefined;
const deps = () => ({ storage: new S3MediaStorage(getStorageConfig()), limiter: new MemoryRateLimiter(), log: quiet });

describe("media pipeline against a real S3-compatible server", () => {
  it("upload -> public URL serves the re-encoded WebP with the recorded metadata -> detach deletes it from the bucket", async () => {
    const { a, a1 } = await twoTenants();
    const d = deps();
    const p = (await createProduct(a.id, a1, validProduct())).id;
    const m = await uploadMedia(a.id, a1, await photo(), d);
    await attachProductImage(a.id, a1, p, m.id, d);

    const row = await prisma.media.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.key).not.toMatch(/https?:|localhost|:9000/); // the database stores no host
    const res = await fetch(mediaPublicUrl(row.key)!);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", row.width, row.height]);
    expect(bytes.length).toBe(row.sizeBytes);
    expect(res.headers.get("content-type")).toBe("image/webp");

    await detachProductImage(a.id, a1, p, d);
    expect(await d.storage.exists(row.key)).toBe(false);
    expect((await fetch(mediaPublicUrl(row.key)!)).status).toBe(404);
    expect(await prisma.media.count()).toBe(0);
  });

  it("a real transport failure during upload surfaces as MediaStorageError; the reservation is kept (the object's fate is unknown) and cleanup recovers it", async () => {
    const { a, a1 } = await twoTenants();
    const broken = { ...deps(), storage: new S3MediaStorage({ ...getStorageConfig(), endpoint: "http://127.0.0.1:1" }) };
    await expect(uploadMedia(a.id, a1, await photo(), broken)).rejects.toBeInstanceOf(MediaStorageError);
    // storage is unreachable, so neither the object nor its absence can be confirmed: the PENDING row is the recovery handle
    const rows = await prisma.media.findMany({ where: { storeId: a1 } });
    expect(rows.map((r) => r.status)).toEqual(["PENDING"]);

    const healthy = deps();
    const later = () => new Date(Date.now() + 2 * 3600_000);
    expect(await runMediaCleanup({ storage: healthy.storage, now: () => new Date(Date.now() + 60_000), log: quiet })).toMatchObject({ expiredPendingRemoved: 0 });
    expect(await runMediaCleanup({ storage: healthy.storage, now: later, log: quiet })).toMatchObject({ expiredPendingRemoved: 1, failures: 0 });
    expect(await prisma.media.count()).toBe(0);
  }, 60_000);

  it("cleanup removes objects that lost their row (e.g. a deleted store) but only after the grace period, and is idempotent", async () => {
    const { a, a1 } = await twoTenants();
    const d = deps();
    const kept = await uploadMedia(a.id, a1, await photo(), d);
    const orphan = newMediaKey(a1);
    await d.storage.put(orphan, await photo(), { contentType: "image/webp" }); // an object with no row

    const young = await runMediaCleanup({ storage: d.storage, log: quiet });
    expect(young.orphanObjectsRemoved).toBe(0);
    expect(await d.storage.exists(orphan)).toBe(true);

    const later = () => new Date(Date.now() + 2 * 3600_000);
    const first = await runMediaCleanup({ storage: d.storage, now: later, log: quiet });
    expect(first.orphanObjectsRemoved).toBe(1);
    expect(await d.storage.exists(orphan)).toBe(false);
    expect(await d.storage.exists(kept.key)).toBe(true); // has a row: untouched
    const second = await runMediaCleanup({ storage: d.storage, now: later, log: quiet });
    expect(second).toMatchObject({ orphanObjectsRemoved: 0, expiredPendingRemoved: 0, deletingFinished: 0, failures: 0 });
    await d.storage.delete(kept.key);
  });
});
