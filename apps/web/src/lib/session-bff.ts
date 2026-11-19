import { cookies } from "next/headers";
import { parseSetCookie } from "@/lib/api-client";
import { readSessionCookie, SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

export const UNAVAILABLE_ERROR = "سرویس موقتاً در دسترس نیست. چند لحظه بعد دوباره تلاش کنید.";

// Helpers of the server actions. They live outside any "use server" file on purpose: exported from one, they would become
// endpoints a client could call.
/** Applies the API's Set-Cookie headers (session cookie set or cleared) to the browser response. */
export async function applyApiCookies(setCookies: string[]): Promise<void> {
  const jar = await cookies();
  for (const raw of setCookies) {
    const c = parseSetCookie(raw);
    if (!c || !(SESSION_COOKIE_NAMES as readonly string[]).includes(c.name)) continue; // only the session cookie, nothing else
    if (c.value === "" || c.maxAge === 0) jar.delete({ name: c.name, path: c.path });
    else jar.set({ name: c.name, value: c.value, httpOnly: true, secure: c.secure, sameSite: c.sameSite ?? "lax", path: c.path, maxAge: c.maxAge });
  }
}

/** The current session cookie as a Cookie header for the API, or null. */
export async function sessionCookieHeader(): Promise<string | null> {
  const jar = await cookies();
  const token = readSessionCookie((n) => jar.get(n)?.value);
  if (!token) return null;
  const name = SESSION_COOKIE_NAMES.find((n) => jar.get(n)?.value === token)!;
  return `${name}=${token}`;
}
