import { hash, verify } from "@node-rs/argon2";

// Argon2id (library default algorithm) with OWASP-recommended minimum parameters:
// m=19 MiB, t=2, p=1. Parameters are embedded in each hash, so they can be raised later.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Verifies against a throwaway hash so unknown-email logins cost the same as wrong-password logins. */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  await verifyPassword(await dummyHash, password);
  return false;
}
