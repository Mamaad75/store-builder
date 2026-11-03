import { createHash } from "node:crypto";
import { db } from "@/lib/db";

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
  loginPerEmail: { limit: 10, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 5, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Keys never contain raw emails/IPs, so the table holds no personal data. */
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
    // Opportunistic cleanup of expired buckets.
    if (Math.random() < 0.01) {
      void db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "resetAt" < now() - interval '1 hour'`.catch(() => {});
    }
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

export function getRateLimiter(): RateLimiter {
  limiter ??= process.env.RATE_LIMIT_BACKEND === "memory" ? new MemoryRateLimiter() : new PostgresRateLimiter();
  return limiter;
}

/**
 * Client IP from X-Forwarded-For. Only meaningful behind a reverse proxy that overwrites this
 * header; deployments must ensure clients cannot set it directly.
 */
export function getClientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || headers.get("x-real-ip")?.trim() || "unknown";
}
