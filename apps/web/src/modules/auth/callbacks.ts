import type { JWT } from "next-auth/jwt";
import { isSessionVersionCurrent } from "./service";

/**
 * Runs whenever the session is read. On sign-in `user` is set and the token is created;
 * afterwards the token is re-validated against the database so that bumping `User.authVersion`
 * (or deleting the user) invalidates all previously issued JWTs. Returning null clears the cookie.
 */
export async function jwtCallback(params: {
  token: JWT;
  user?: { id?: string; authVersion?: number } | null;
}): Promise<JWT | null> {
  const { token, user } = params;
  if (user?.id) {
    token.sub = user.id;
    token.authVersion = user.authVersion ?? 0;
    return token;
  }
  if (!token.sub || !(await isSessionVersionCurrent(token.sub, token.authVersion))) return null;
  return token;
}
