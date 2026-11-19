/** Names of the session cookie set by the API (ADR 0001, N3): `__Host-` prefixed over https, plain over loopback http. */
export const SESSION_COOKIE_NAMES = ["__Host-sb_session", "sb_session"] as const;

export function readSessionCookie(get: (name: string) => string | undefined): string | null {
  for (const name of SESSION_COOKIE_NAMES) {
    const v = get(name);
    if (v) return v;
  }
  return null;
}
