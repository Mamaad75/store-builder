import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { cleanupExpiredBuckets, PostgresRateLimiter } from "./rate-limit";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const count = () => prisma.rateLimitBucket.count();

describe("cleanupExpiredBuckets", () => {
  it("deletes only buckets expired for more than the grace period", async () => {
    await prisma.$executeRaw`
      INSERT INTO "RateLimitBucket" ("key","count","resetAt") VALUES
        ('old',1, now() - interval '2 hours'),
        ('recently-expired',1, now() - interval '10 minutes'),
        ('active',1, now() + interval '10 minutes')`;
    expect(await cleanupExpiredBuckets()).toBe(1);
    const keys = (await prisma.rateLimitBucket.findMany()).map((b) => b.key).sort();
    expect(keys).toEqual(["active", "recently-expired"]);
  });

  it("works in bounded batches and can drain a large backlog", async () => {
    await prisma.$executeRaw`
      INSERT INTO "RateLimitBucket" ("key","count","resetAt")
      SELECT 'k'||g, 1, now() - interval '3 hours' FROM generate_series(1, 2500) g`;
    expect(await cleanupExpiredBuckets(1)).toBe(1000); // one batch only
    expect(await count()).toBe(1500);
    expect(await cleanupExpiredBuckets()).toBe(1500);
    expect(await count()).toBe(0);
  });

  it("is safe to run concurrently with itself and with live limiting", async () => {
    await prisma.$executeRaw`
      INSERT INTO "RateLimitBucket" ("key","count","resetAt")
      SELECT 'k'||g, 1, now() - interval '3 hours' FROM generate_series(1, 1500) g`;
    const limiter = new PostgresRateLimiter();
    const [a, b, hit] = await Promise.all([
      cleanupExpiredBuckets(),
      cleanupExpiredBuckets(),
      limiter.consume("live", { limit: 5, windowSeconds: 60 }),
    ]);
    expect(a + b).toBe(1500);
    expect(hit.allowed).toBe(true);
    expect(await count()).toBe(1); // only the live bucket remains
  });

  it("does not remove an expired bucket's correctness: next hit starts a fresh window", async () => {
    await prisma.$executeRaw`INSERT INTO "RateLimitBucket" ("key","count","resetAt") VALUES ('k', 99, now() - interval '1 minute')`;
    const r = await new PostgresRateLimiter().consume("k", { limit: 3, windowSeconds: 60 });
    expect(r).toMatchObject({ allowed: true, remaining: 2 });
  });
});
