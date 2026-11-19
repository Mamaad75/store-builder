import type { RateLimitRule } from "../../lib/rate-limit.js";

export * from "@store-builder/shared/modules/media/limits";

/** Minimum age before cleanup touches a row/object, far longer than any upload can take. */
export const CLEANUP_GRACE_MS = 60 * 60 * 1000;

export const MEDIA_RULES = {
  /** Per authenticated user AND store. */
  uploadPerUserStore: { limit: 20, windowSeconds: 10 * 60 },
} as const satisfies Record<string, RateLimitRule>;
