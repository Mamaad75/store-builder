/**
 * Platform operators (phase 3.1, D31-1). Pure rules. One role today; the enum in the database leaves room for narrower ones later
 * (support, finance) without changing this rule set's shape.
 */
export const PLATFORM_ROLES = ["SUPER_ADMIN"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type RevokeRefusal = "self" | "last_admin" | null;

/** A super admin may revoke another one, never themself (no accidental lock-out) and never the last one. */
export function revokeRefusal(actorId: string, targetId: string, adminCount: number): RevokeRefusal {
  if (actorId === targetId) return "self";
  if (adminCount <= 1) return "last_admin";
  return null;
}

/** The associated data every platform secret is bound to: a ciphertext only opens as the same platform secret. */
export const platformSecretContext = (name: string): string => `platform|name:${name}`;

/** Last 4 characters for recognition, only for values long enough that 4 characters reveal little (same rule as store secrets). */
export function secretHint(value: string): string | null {
  const chars = Array.from(value);
  return chars.length >= 24 ? chars.slice(-4).join("") : null;
}
