/** Ports of the customers module (phase 3.1). Implemented in infrastructure/; the application layer sees only these. */

export interface CustomerView {
  id: string;
  storeId: string;
  phone: string;
  name: string | null;
  authVersion: number;
  phoneVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface CustomerRepository {
  /**
   * SMS-code sign-in: the customer with this phone in this store, created when missing; marks the phone verified and records the sign-in.
   * The first verification drops a password set before the phone was proven (and ends its sessions): whoever set it never showed they own
   * the phone (phase 3.3b).
   */
  signIn(storeId: string, phone: string, now: Date): Promise<CustomerView>;
  /** Phase 3.3b: the customer with this phone and their password hash (null = no password), or null. */
  credentials(storeId: string, phone: string): Promise<{ customer: CustomerView; passwordHash: string | null } | null>;
  /**
   * Phase 3.3b: a password account for this phone. A guest-only record (no password, phone never verified) is taken over; a phone that
   * already has a password or was verified by SMS code is "exists" (nothing changes).
   */
  register(storeId: string, phone: string, name: string, passwordHash: string, now: Date): Promise<CustomerView | "exists">;
  recordLogin(storeId: string, id: string, now: Date): Promise<void>;
  find(storeId: string, id: string): Promise<CustomerView | null>;
  /** Newest first; `before` = createdAt of the last row seen (keyset). */
  list(storeId: string, o: { before?: Date; limit: number }): Promise<CustomerView[]>;
  /** Ends every session of the customer. */
  bumpAuthVersion(storeId: string, id: string): Promise<void>;
}

export interface ChallengeRow {
  id: string;
  codeHash: string;
  attempts: number;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface OtpRepository {
  /** The newest challenge of this phone in this store, if any. */
  latest(storeId: string, phone: string): Promise<ChallengeRow | null>;
  create(storeId: string, phone: string, codeHash: string, expiresAt: Date): Promise<string>;
  /** Counts one try, atomically and only while the challenge is unconsumed and under `max`; false when no try is left. */
  countAttempt(id: string, max: number): Promise<boolean>;
  /** Marks it used, atomically (compare-and-set); false when it was already used. */
  consume(id: string, now: Date): Promise<boolean>;
  /** Removes a challenge whose code could not be sent (so it does not block the next request). */
  discard(id: string): Promise<void>;
}

/** Code generation and hashing (HMAC with a server key): the application never handles key material. */
export interface OtpCodec {
  newCode(): string;
  hash(storeId: string, phone: string, code: string): string;
  /** Constant-time comparison of two hashes. */
  same(a: string, b: string): boolean;
}

export interface OtpSender {
  /** Throws on any delivery failure (the message is never shown or logged). */
  sendOtp(phoneE164: string, code: string): Promise<void>;
}

/** Argon2id (the merchant sign-in's parameters); `verifyDummy` costs the same as a real check (unknown phones are not faster). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  verifyDummy(password: string): Promise<false>;
}

export interface Limiter {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

export interface CustomerClaims {
  customerId: string;
  storeId: string;
  authVersion: number;
}

/** Customer session tokens: a separate key and audience from merchant sessions, so neither can stand in for the other. */
export interface CustomerTokens {
  issue(c: CustomerClaims): Promise<string>;
  read(token: string): Promise<CustomerClaims | null>;
}
