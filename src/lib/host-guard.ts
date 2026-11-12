import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getAppEnv } from "./env";
import { resolveHost } from "./hostname";

/** True when the RAW Host header names a store subdomain (forwarded-host headers are never consulted). */
export const isStoreHostHeader = (host: string | null | undefined, rootDomain = getAppEnv().APP_ROOT_DOMAIN): boolean => resolveHost(host, rootDomain).kind === "store";

/**
 * Second line of defence behind the proxy: platform-only pages (dashboard, authentication, preview) answer 404 when
 * reached through a store host, even if the proxy were somehow bypassed.
 */
export async function assertPlatformHost(): Promise<void> {
  if (isStoreHostHeader((await headers()).get("host"))) notFound();
}

/** Same guard for route handlers: returns a 404 response when the request arrived on a store host. */
export function platformOnly(req: Request): Response | null {
  return isStoreHostHeader(req.headers.get("host")) ? new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } }) : null;
}
