import type { RateLimitRule } from "@/modules/auth/rate-limit";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // original file
export const MAX_INPUT_PIXELS = 25_000_000; // decoded input (decompression-bomb guard)
export const MAX_OUTPUT_DIMENSION = 2048; // processed output, each side
export const MAX_MEDIA_PER_STORE = 100;
export const MAX_MEDIA_BYTES_PER_STORE = 100 * 1024 * 1024; // processed bytes
export const OUTPUT_MIME = "image/webp" as const;

/** Minimum age before cleanup touches a row/object, far longer than any upload can take. */
export const CLEANUP_GRACE_MS = 60 * 60 * 1000;

export const MEDIA_RULES = {
  /** Per authenticated user AND store. */
  uploadPerUserStore: { limit: 20, windowSeconds: 10 * 60 },
} as const satisfies Record<string, RateLimitRule>;
