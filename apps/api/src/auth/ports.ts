/** What the auth module needs from storage. Prisma implementations live in `database/`; tests use in-memory ones. */
export interface UserRecord {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
  authVersion: number;
}

export interface UserRepository {
  /**
   * Returns null when the username is already taken (decided by the unique index, never by read-then-write). With `invite` (MVP item 2,
   * invite-only registration) the invitation is redeemed in the SAME transaction: "invite_invalid" when it is unknown, used, revoked or
   * expired (nothing is created); a taken username leaves the invitation unused.
   */
  create(data: { name: string; username: string; passwordHash: string }, invite?: { codeHash: string; now: Date }): Promise<UserRecord | null | "invite_invalid">;
  /** MVP item 2: the platform's registration mode ("invite" unless a super admin opened it). */
  registrationMode(): Promise<"invite" | "open">;
  /**
   * MVP item 2: sets a new password with a recovery link issued by platform support: the link is consumed (single use, not expired, not
   * revoked) and the password replaced with authVersion incremented, in one transaction. false = the link is not usable.
   */
  redeemRecovery(tokenHash: string, passwordHash: string, now: Date): Promise<boolean>;
  /** MVP item 2: when platform support last recovered this account (shown to the owner as a notice). */
  recoveredAt(id: string): Promise<Date | null>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Replaces the hash AND increments authVersion (every issued token dies). */
  setPassword(id: string, passwordHash: string): Promise<void>;
  /** Increments authVersion only. */
  bumpAuthVersion(id: string): Promise<void>;
}

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}
export interface RateLimiter {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

export interface SafeUser {
  id: string;
  username: string;
  name: string;
}
