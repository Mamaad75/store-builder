import { createHash } from "node:crypto";
import { rateLimitKey } from "../../../lib/rate-limit.js";
import { createCheckoutService } from "../../checkout/checkout.api.js";
import { AnalyticsService } from "../application/analytics.service.js";
import type { Limiter } from "../application/ports.js";
import { VisitService } from "../application/visit.service.js";
import { PrismaAnalyticsRepository } from "./prisma-analytics.repository.js";

interface RateLimiterLike {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

export function createVisitService(o: { limiter: RateLimiterLike; secret: string }): VisitService {
  const limiter: Limiter = { consume: (key, rule) => o.limiter.consume(rateLimitKey("analytics", key), rule) };
  const checkout = createCheckoutService({ limiter: o.limiter });
  return new VisitService(new PrismaAnalyticsRepository(), {
    liveStoreId: (label) => checkout.liveStoreId(label).catch(() => null), // unknown, unpublished and suspended stores are all "not counted"
    limiter,
    sha256,
    secret: o.secret,
  });
}

export const createAnalyticsService = (): AnalyticsService => new AnalyticsService(new PrismaAnalyticsRepository());

/** The db-cleanup job. */
export const purgeAnalytics = (now = new Date()) => new PrismaAnalyticsRepository().purge(now);
