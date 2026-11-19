import { cookies } from "next/headers";
import { readSessionCookie, SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

/** The person's session cookie as a Cookie header for server-side reads of the API (the gateway). Null when there is none. */
export async function sessionCookieHeader(): Promise<string | null> {
  const jar = await cookies();
  const token = readSessionCookie((n) => jar.get(n)?.value);
  if (!token) return null;
  const name = SESSION_COOKIE_NAMES.find((n) => jar.get(n)?.value === token)!;
  return `${name}=${token}`;
}
