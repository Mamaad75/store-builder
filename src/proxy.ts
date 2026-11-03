import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Early redirect for unauthenticated dashboard requests. This is a convenience layer only;
 * authorisation is enforced again on the server in layouts/actions via requireUser().
 */
export const proxy = auth((req) => {
  if (!req.auth?.user?.id) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = { matcher: ["/dashboard/:path*"] };
