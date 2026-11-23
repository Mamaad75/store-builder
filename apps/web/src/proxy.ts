import { NextResponse, type NextRequest } from "next/server";
import { readSessionCookie } from "@/lib/session-cookie";
import { getAppEnv } from "@/lib/env";
import { securityHeaders } from "@/lib/security-headers";
import { getHostPolicy } from "@/lib/host-policy";
import { normalizeHostHeader } from "@store-builder/shared/lib/hostname";
import { STORE_ROUTE_PREFIX, decideRoute } from "@store-builder/shared/lib/store-routing";
import { resolveProductRedirect } from "@/gateway/public";

/**
 * Early redirect for dashboard and draft-preview requests without a session cookie. This is a convenience layer only (it does not
 * validate the token): authorisation is enforced again on the server in layouts/actions via requireUser(), which asks the API.
 */
function requireSession(req: NextRequest): NextResponse {
  if (!readSessionCookie((n) => req.cookies.get(n)?.value)) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** One neutral 404 for everything unavailable: the application's own not-found page, never cacheable. */
const neutralNotFound = (req: NextRequest) => NextResponse.rewrite(new URL("/--not-found", req.url), { status: 404, headers: NO_STORE });

async function route(req: NextRequest): Promise<Response> {
  const env = getAppEnv();
  const policy = getHostPolicy();
  // Only the raw Host header is trusted; X-Forwarded-Host / Forwarded / X-Original-Host are never read. Any host that is not
  // the configured root domain, www.<root> or a valid store subdomain is answered here with the neutral 404 (unknown hosts).
  const decision = decideRoute(req.headers.get("host"), req.nextUrl.pathname, policy.rootDomain, policy.aliases);

  if (decision.kind === "not_found") return neutralNotFound(req);

  if (decision.kind === "store") {
    if (decision.productSlug !== null) {
      // A historical product slug: a real, permanent 301 straight to the slug the LIVE version uses. `no-store` keeps browsers
      // from caching it, because a rollback or republish can legitimately change where (or whether) it redirects.
      const to = await resolveProductRedirect(decision.label, decision.productSlug);
      if (to) {
        const host = normalizeHostHeader(req.headers.get("host"))!;
        return NextResponse.redirect(`${env.APP_PROTOCOL}://${host}/products/${encodeURIComponent(to)}${req.nextUrl.search}`, { status: 301, headers: NO_STORE });
      }
    }
    const target = `${STORE_ROUTE_PREFIX}/${decision.label}${decision.path === "/" ? "" : decision.path}${req.nextUrl.search}`;
    return NextResponse.rewrite(new URL(target, req.url), { headers: NO_STORE });
  }

  const p = req.nextUrl.pathname;
  if (p.startsWith("/dashboard") || p.startsWith("/preview")) return requireSession(req);
  if (p.startsWith("/platform")) return requireSession(req); // phase 3.1: the super admin pages (the role is checked on the server)
  return NextResponse.next();
}

/** Every response, whichever branch produced it (rewrite, redirect, 404, next), carries the platform's security headers. */
export async function proxy(req: NextRequest) {
  const res = await route(req);
  for (const [k, v] of Object.entries(securityHeaders(process.env))) res.headers.set(k, v);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
