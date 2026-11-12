import { resolveHost } from "./hostname";

/** The internal route namespace that public store pages are rewritten into. Never reachable by a client directly. */
export const STORE_ROUTE_PREFIX = "/store-host";

export type RouteDecision =
  /** The configured platform host: normal handling (auth gate for dashboard/preview). */
  | { kind: "platform" }
  /**
   * The request must answer with the neutral 404: an UNKNOWN host (not the configured root domain, `www.<root>` or a valid
   * store subdomain: foreign domains, IP hosts, nested labels, wrong ports), the internal namespace asked for directly, or an unsafe path.
   */
  | { kind: "not_found" }
  /** A store host: every path is a storefront path. `productSlug` is set for `/products/<slug>`. */
  | { kind: "store"; label: string; path: string; productSlug: string | null };

const UNSAFE_PATH_RE = /%2e|%2f|%5c|%00|%25|\\|\u0000|\/\/|(?:^|\/)\.\.?(?:\/|$)/i;

/** True for a path that may be interpreted on a store host: no traversal, no encoded separators, no NUL, no double slash. */
export function isSafeStorePath(pathname: string): boolean {
  return pathname.startsWith("/") && pathname.length <= 512 && !UNSAFE_PATH_RE.test(pathname);
}

const decodeSlug = (segment: string): string | null => {
  try {
    const s = decodeURIComponent(segment);
    return s.length > 0 && s.length <= 200 && !/[\u0000-\u001f/\\]/.test(s) ? s : null;
  } catch {
    return null;
  }
};

/**
 * Pure routing decision from the raw Host header and the path. Only the Host header decides (never forwarded-host
 * headers). Hosts are validated here, in the application, whatever sits in front of it. On a store host EVERY path becomes a storefront path, so dashboard, login, auth API, health and preview are
 * simply not reachable there.
 */
export function decideRoute(hostHeader: string | null | undefined, pathname: string, rootDomain: string, platformAliases: readonly string[] = []): RouteDecision {
  const host = resolveHost(hostHeader, rootDomain, platformAliases);
  if (host.kind === "unknown") return { kind: "not_found" };
  if (host.kind === "platform") {
    return pathname === STORE_ROUTE_PREFIX || pathname.startsWith(`${STORE_ROUTE_PREFIX}/`) ? { kind: "not_found" } : { kind: "platform" };
  }
  if (!isSafeStorePath(pathname)) return { kind: "not_found" };
  const m = /^\/products\/([^/]+)$/.exec(pathname);
  const productSlug = m ? decodeSlug(m[1]!) : null;
  if (m && productSlug === null) return { kind: "not_found" };
  return { kind: "store", label: host.subdomain, path: pathname, productSlug };
}
