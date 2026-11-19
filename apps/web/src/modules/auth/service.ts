import { db } from "@/lib/db";

/** Only data that is safe to return to callers. Never includes the password hash. */
export interface SafeUser {
  id: string;
  username: string;
  name: string;
}

/*
 * Registration, login, password change and session revocation live in the NestJS API (ADR 0001, N3). The dashboard still reads the
 * signed-in user's profile here until the data layer moves too (N4+).
 */
export async function getSafeUser(userId: string): Promise<SafeUser | null> {
  return db.user.findUnique({ where: { id: userId }, select: { id: true, username: true, name: true } });
}
