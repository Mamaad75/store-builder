/** Store secret rules (phase 2.4, D24-1). Pure. */

/** "<area>.<provider>.<field>" in lower case, e.g. "payment.zarinpal.merchant_id" (the database checks the same format). */
export const SECRET_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export const MAX_SECRET_NAME = 80;
export const MAX_SECRET_VALUE = 4096;
export const MAX_SECRETS_PER_STORE = 20;

export const isSecretName = (name: string): boolean => name.length <= MAX_SECRET_NAME && SECRET_NAME_RE.test(name);

/**
 * The last four characters, for recognising a stored value. Stored OUTSIDE the envelope, so only for values of 24+ characters, where four
 * characters reveal little (security review 2026-11-21: 12 was too short).
 */
export const HINT_MIN_LENGTH = 24;
export function hintOf(value: string): string | null {
  const chars = Array.from(value);
  return chars.length >= HINT_MIN_LENGTH ? chars.slice(-4).join("") : null;
}

/** The associated data every envelope is bound to: a ciphertext only opens for the same store AND name. */
export const secretContext = (storeId: string, name: string): string => `store:${storeId}|name:${name}`;
