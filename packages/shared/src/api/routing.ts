/**
 * API versioning (phase 2.5, ADR 0002 §2.9, decision D25-1). The versioned surface is `/api/v1/<scope>/...` with five scopes:
 *
 *   /api/v1/auth/*      sign-in, sign-up, session              (served today at /api/auth/*)
 *   /api/v1/me/*        the signed-in account                  (/api/me/*)
 *   /api/v1/admin/*     the merchant's stores                  (/api/stores/*)
 *   /api/v1/store/*     the storefront, for shoppers           (/api/public/*)
 *   /api/v1/platform/*  platform operators (super admins)      (/api/platform/*; phase 3.1, not routed by Caddy yet)
 *
 * Both surfaces reach the SAME handlers: a v1 request is rewritten to the handler path before routing, so there is one implementation
 * and one set of guards. The unversioned paths stay (deprecated) until the web app has moved to v1. Health and readiness stay
 * unversioned (operations, not product API). Pure functions: the API middleware, the OpenAPI generator and the tests share them.
 */
export const V1 = "/api/v1";

const MAP: readonly { v1: string; handler: string }[] = [
  { v1: "/api/v1/auth", handler: "/api/auth" },
  { v1: "/api/v1/me", handler: "/api/me" },
  { v1: "/api/v1/admin/stores", handler: "/api/stores" },
  { v1: "/api/v1/store", handler: "/api/public" },
  { v1: "/api/v1/platform", handler: "/api/platform" },
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Handler path of a v1 path, or null when the v1 path maps to nothing (unknown scope or the bare prefix). */
export function handlerPathOf(v1Path: string): string | null {
  for (const m of MAP) if (under(v1Path, m.v1)) return m.handler + v1Path.slice(m.v1.length);
  return null;
}

/** v1 path of a handler path, or null when the handler is not part of the versioned surface (health, readiness). */
export function v1PathOf(handlerPath: string): string | null {
  for (const m of MAP) if (under(handlerPath, m.handler)) return m.v1 + handlerPath.slice(m.handler.length);
  return null;
}

export const isV1Path = (path: string) => under(path, V1);
