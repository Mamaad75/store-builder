/** What the auth module needs from storage. Prisma implementations live in `database/`; tests use in-memory ones. */
export interface UserRecord {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
  authVersion: number;
}

export interface UserRepository {
  /** Returns null when the username is already taken (decided by the unique index, never by read-then-write). */
  create(data: { name: string; username: string; passwordHash: string }): Promise<UserRecord | null>;
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
