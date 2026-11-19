import { Inject, Injectable } from "@nestjs/common";
import { PRISMA_CLIENT } from "../config/tokens.js";
import type { RateLimiter, RateLimitResult, RateLimitRule } from "../auth/ports.js";
import type { Prisma } from "./prisma-client.js";

/** Fixed-window limiter backed by PostgreSQL (the same "RateLimitBucket" table as the web app): one atomic upsert per call. */
@Injectable()
export class PostgresRateLimiter implements RateLimiter {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: Prisma) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const rows = await this.db.$queryRaw<{ count: number; ttl: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, now() + make_interval(secs => ${rule.windowSeconds}))
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimitBucket"."resetAt" <= now() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= now() THEN now() + make_interval(secs => ${rule.windowSeconds}) ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", CEIL(EXTRACT(EPOCH FROM ("resetAt" - now())))::int AS ttl`;
    const row = rows[0]!;
    return { allowed: row.count <= rule.limit, remaining: Math.max(0, rule.limit - row.count), retryAfterSeconds: Math.max(1, row.ttl) };
  }
}
