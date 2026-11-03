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

/** rootDomain may include a port, e.g. "localhost:3000". */
export function resolveHost(hostHeader: string | null | undefined, rootDomain: string): HostResolution {
  if (!hostHeader) return { kind: "unknown" };
  const host = hostHeader.trim().toLowerCase();
  const root = rootDomain.trim().toLowerCase();
  if (host === root || host === `www.${root}`) return { kind: "platform" };
  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) return { kind: "unknown" };
  const label = host.slice(0, -suffix.length);
  const check = validateSubdomain(label);
  if (!check.ok) return { kind: "unknown" };
  return { kind: "store", subdomain: check.value };
}
