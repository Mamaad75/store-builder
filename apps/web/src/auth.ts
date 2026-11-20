import { cache } from "react";
import { cookies } from "next/headers";
import { ApiUnavailableError, callApi } from "@/lib/api-client";
import { readSessionCookie, SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
}
export interface Session {
  user: SessionUser;
}

/**
 * The signed-in user, asked of the API (ADR 0001, N3: Auth.js is gone). One request per render (React cache) however many layouts and
 * pages ask. The API verifies the token AND that the user still exists with the same authVersion, so a revoked or expired token is null.
 * If the API is unreachable the answer is null (the person is sent to /login) and nothing is cached by the framework.
 */
export const auth = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = readSessionCookie((n) => jar.get(n)?.value);
  if (!token) return null;
  const name = SESSION_COOKIE_NAMES.find((n) => jar.get(n)?.value === token)!;
  try {
    const r = await callApi<{ user: SessionUser }>("GET", "/api/auth/me", { cookie: `${name}=${token}` });
    const u = r.status === 200 ? r.body?.user : null;
    return u?.id ? { user: { id: u.id, username: u.username, name: u.name } } : null;
  } catch (e) {
    if (e instanceof ApiUnavailableError) return null;
    throw e;
  }
});
