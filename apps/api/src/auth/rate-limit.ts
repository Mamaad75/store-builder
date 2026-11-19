import { createHash } from "node:crypto";
import type { RateLimitRule } from "./ports.js";

export const AUTH_RULES = {
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  loginPerUsername: { limit: 10, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 5, windowSeconds: 60 * 60 },
  changePasswordPerUser: { limit: 10, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Keys never contain raw usernames or IPs (only a hash), so the table holds no personal data. */
export function rateLimitKey(scope: string, value: string): string {
  return `${scope}:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}
