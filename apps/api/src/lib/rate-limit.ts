import { createHash } from "node:crypto";
import { db } from "./db.js";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Storage-agnostic limiter. Production uses the shared Postgres implementation; a Redis
 * implementation (INCR + EXPIRE) can be added behind the same interface for multi-instance
 * deployments without touching callers.
 */
export interface RateLimiter {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

export const AUTH_RULES = {
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  loginPerUsername: { limit: 10, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 5, windowSeconds: 60 * 60 },
  changePasswordPerUser: { limit: 10, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Keys never contain raw usernames/IPs (only a hash), so the table holds no personal data. */
export function rateLimitKey(scope: string, value: string): string {
  return `${scope}:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

/** Fixed-window limiter backed by PostgreSQL; one atomic upsert per call, shared by all instances. */
export class PostgresRateLimiter implements RateLimiter {
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const rows = await db.$queryRaw<{ count: number; ttl: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, now() + make_interval(secs => ${rule.windowSeconds}))
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimitBucket"."resetAt" <= now() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= now() THEN now() + make_interval(secs => ${rule.windowSeconds}) ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", CEIL(EXTRACT(EPOCH FROM ("resetAt" - now())))::int AS ttl`;
    const row = rows[0]!;
    maybeCleanupExpiredBuckets();
    return {
      allowed: row.count <= rule.limit,
      remaining: Math.max(0, rule.limit - row.count),
      retryAfterSeconds: Math.max(1, row.ttl),
    };
  }
}

/** Process-local limiter: for tests and single-process development only. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private now: () => number = Date.now) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + rule.windowSeconds * 1000 };
      this.buckets.set(key, b);
    }
    b.count += 1;
    return {
      allowed: b.count <= rule.limit,
      remaining: Math.max(0, rule.limit - b.count),
      retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - t) / 1000)),
    };
  }
}

let limiter: RateLimiter | undefined;
let backend: "postgres" | "memory" = "postgres";

/** Called once at start-up with the validated configuration ("memory" is for single-process development and tests only). */
export function configureRateLimiter(kind: "postgres" | "memory"): void {
  backend = kind;
  limiter = undefined;
}

export function getRateLimiter(): RateLimiter {
  limiter ??= backend === "memory" ? new MemoryRateLimiter() : new PostgresRateLimiter();
  return limiter;
}

const CLEANUP_GRACE = "1 hour";
const CLEANUP_BATCH = 1000;
const CLEANUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanupAt = 0;

/**
 * Deletes buckets that expired more than an hour ago, in bounded batches (never one giant
 * DELETE). Expired rows are already harmless for correctness (the next hit resets them), so
 * this only bounds table size. Safe to run concurrently from several instances or a cron job.
 * Returns the number of rows deleted.
 */
export async function cleanupExpiredBuckets(maxBatches = 10): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const deleted = await db.$executeRaw`
      DELETE FROM "RateLimitBucket" WHERE "key" IN (
        SELECT "key" FROM "RateLimitBucket"
        WHERE "resetAt" < now() - ${CLEANUP_GRACE}::interval
        LIMIT ${CLEANUP_BATCH} FOR UPDATE SKIP LOCKED)`;
    total += deleted;
    if (deleted < CLEANUP_BATCH) break;
  }
  return total;
}

/** Throttled, fire-and-forget cleanup piggybacking on traffic (at most once per 5 min per process). */
function maybeCleanupExpiredBuckets(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  lastCleanupAt = now;
  void cleanupExpiredBuckets().catch(() => {});
}
