import { digitsToAscii } from "@store-builder/shared/lib/text";

/**
 * One-time sign-in codes for customers (phase 3.1, D31-2). Pure rules; the application layer applies them.
 * 6 digits, valid 2 minutes, at most 5 wrong tries, a new code for a phone at most once a minute and 5 times an hour, request and verify
 * attempts capped per IP. Whether a phone is known never changes an answer.
 */
export const OTP = {
  digits: 6,
  ttlSeconds: 120,
  maxAttempts: 5,
  resendSeconds: 60,
  perPhonePerHour: { limit: 5, windowSeconds: 3600 },
  /** The same phone across EVERY store (one victim, many shops): per hour and per day. */
  perPhoneAllStoresPerHour: { limit: 10, windowSeconds: 3600 },
  perPhoneAllStoresPerDay: { limit: 20, windowSeconds: 86_400 },
  /** Platform-wide SMS budget: a burst beyond it stops sending (cost and abuse circuit breaker). */
  platformPerHour: { limit: 600, windowSeconds: 3600 },
  requestsPerIpPerHour: { limit: 20, windowSeconds: 3600 },
  verifiesPerIpPerHour: { limit: 60, windowSeconds: 3600 },
} as const;

const CODE_RE = /^[0-9]{6}$/; // OTP.digits

/** The code as typed (Persian digits and spaces allowed), or null when it cannot be a code. */
export function parseCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 20) return null;
  const s = digitsToAscii(raw).replace(/\s/g, "");
  return CODE_RE.test(s) ? s : null;
}

/** Customer sessions last 30 days (a shop, not a bank); signing out everywhere bumps authVersion. */
export const CUSTOMER_SESSION_SECONDS = 30 * 24 * 3600;

export interface ChallengeFacts {
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
}

export type ChallengeState = "usable" | "expired" | "consumed" | "exhausted";

export function challengeState(c: ChallengeFacts, now: Date): ChallengeState {
  if (c.consumedAt) return "consumed";
  if (c.expiresAt.getTime() <= now.getTime()) return "expired";
  if (c.attempts >= OTP.maxAttempts) return "exhausted";
  return "usable";
}

/**
 * The rate-limit key of a client address: IPv4 as it is, IPv6 by its /64 network (one subscriber usually owns a whole /64, so per-address
 * keys would let them rotate addresses freely).
 */
export function ipLimitKey(ip: string): string {
  const raw = ip.replace(/^::ffff:/i, "");
  if (!raw.includes(":")) return raw;
  const [head = "", tail = ""] = raw.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = raw.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (g || "0").toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Seconds until a new code may be sent for this phone (0 = now). */
export function resendWait(lastCreatedAt: Date | null, now: Date): number {
  if (!lastCreatedAt) return 0;
  const left = OTP.resendSeconds - Math.floor((now.getTime() - lastCreatedAt.getTime()) / 1000);
  return Math.max(0, left);
}
