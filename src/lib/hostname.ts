/**
 * Pure helpers for mapping a request Host header to the platform panel or a store subdomain.
 * Wiring this into routing happens in the publishing step; it is isolated here so it can be unit tested.
 */

export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www", "app", "api", "admin", "dashboard", "panel", "mail", "smtp", "ftp",
  "cdn", "static", "assets", "media", "img", "blog", "help", "support",
  "status", "docs", "dev", "staging", "test", "demo", "localhost", "login",
  "register", "auth", "billing", "store", "stores", "shop", "preview",
]);

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export type SubdomainCheck =
  | { ok: true; value: string }
  | { ok: false; reason: "invalid" | "reserved" };

export function validateSubdomain(input: string): SubdomainCheck {
  const value = input.trim().toLowerCase();
  if (!SUBDOMAIN_RE.test(value) || value.includes("--")) return { ok: false, reason: "invalid" };
  if (RESERVED_SUBDOMAINS.has(value)) return { ok: false, reason: "reserved" };
  return { ok: true, value };
}

export type HostResolution =
  | { kind: "platform" }
  | { kind: "store"; subdomain: string }
  | { kind: "unknown" };

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]{2,45}\])(?::\d{1,5})?$/;

/**
 * Normalises the RAW `Host` header (the only host input this application trusts; `X-Forwarded-Host`, `Forwarded` and the
 * like are never read): trimmed and lowercased, ONE trailing dot removed from the host part, port kept. Anything that is not
 * a plain `host[:port]` (several values, userinfo, paths, spaces, control characters, percent-escapes) is rejected (null).
 */
export function normalizeHostHeader(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let h = raw.trim().toLowerCase();
  if (h.length === 0 || h.length > 260) return null;
  const m = /^(.*?)(:\d{1,5})?$/.exec(h);
  if (m && !h.startsWith("[")) {
    const host = m[1]!.endsWith(".") ? m[1]!.slice(0, -1) : m[1]!;
    h = host + (m[2] ?? "");
  }
  if (!HOST_RE.test(h)) return null;
  const port = /:(\d{1,5})$/.exec(h)?.[1];
  if (port !== undefined && Number(port) > 65535) return null;
  return h;
}

/** rootDomain may include a port, e.g. "localhost:3000". The host must match it exactly, including the port. */
export function resolveHost(hostHeader: string | null | undefined, rootDomain: string): HostResolution {
  const host = normalizeHostHeader(hostHeader);
  if (!host) return { kind: "unknown" };
  const root = rootDomain.trim().toLowerCase();
  if (host === root || host === `www.${root}`) return { kind: "platform" };
  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) return { kind: "unknown" };
  const label = host.slice(0, -suffix.length);
  const check = validateSubdomain(label);
  if (!check.ok) return { kind: "unknown" };
  return { kind: "store", subdomain: check.value };
}
