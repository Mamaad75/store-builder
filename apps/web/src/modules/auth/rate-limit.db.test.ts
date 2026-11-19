import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { PostgresRateLimiter } from "./rate-limit";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("PostgresRateLimiter (shared backend)", () => {
  it("counts across limiter instances, blocks, and resets after the window", async () => {
    const a = new PostgresRateLimiter();
    const b = new PostgresRateLimiter(); // simulates a second app instance
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await a.consume("k1", rule)).allowed).toBe(true);
    expect((await b.consume("k1", rule)).allowed).toBe(true);
    const blocked = await a.consume("k1", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await a.consume("k2", rule)).allowed).toBe(true);
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "resetAt" = now() - interval '1 second' WHERE "key" = 'k1'`;
    expect((await b.consume("k1", rule)).allowed).toBe(true);
  });
  it("is atomic under concurrency", async () => {
    const l = new PostgresRateLimiter();
    const rule = { limit: 5, windowSeconds: 60 };
    const results = await Promise.all(Array.from({ length: 20 }, () => l.consume("burst", rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
