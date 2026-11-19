import type { ApiConfig } from "../config/env.js";

/** `__Host-` binds the cookie to this exact host (no Domain, Path=/, Secure): only possible over https. */
export function sessionCookieName(config: Pick<ApiConfig, "secureCookies">): string {
  return config.secureCookies ? "__Host-sb_session" : "sb_session";
}

export function sessionCookieOptions(config: Pick<ApiConfig, "secureCookies">) {
  return { httpOnly: true, secure: config.secureCookies, sameSite: "lax" as const, path: "/" };
}

/** Minimal, strict Cookie-header parser: the value of `name`, or null. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}
