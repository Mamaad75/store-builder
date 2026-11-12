import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getAppEnv } from "@/lib/env";
import { normalizeHostHeader } from "@/lib/hostname";
import { STORE_ROUTE_PREFIX, decideRoute } from "@/lib/store-routing";
import { resolveProductRedirect } from "@/modules/publishing/public-read";

/**
 * Early redirect for unauthenticated dashboard and draft-preview requests. This is a convenience layer only;
 * authorisation is enforced again on the server in layouts/actions via requireUser().
 */
const requireSession = auth((req) => {
  if (!req.auth?.user?.id) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** One neutral 404 for everything unavailable: the application's own not-found page, never cacheable. */
const neutralNotFound = (req: NextRequest) => NextResponse.rewrite(new URL("/--not-found", req.url), { status: 404, headers: NO_STORE });

export async function proxy(req: NextRequest, ev: never) {
  const env = getAppEnv();
  // Only the raw Host header is trusted; X-Forwarded-Host / Forwarded / X-Original-Host are never read.
  const decision = decideRoute(req.headers.get("host"), req.nextUrl.pathname, env.APP_ROOT_DOMAIN);

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
  if (p.startsWith("/dashboard") || p.startsWith("/preview")) return (requireSession as unknown as (r: NextRequest, e: never) => Promise<Response>)(req, ev);
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
