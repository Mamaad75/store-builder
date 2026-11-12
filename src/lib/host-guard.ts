import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getHostPolicy } from "./host-policy";
import { resolveHost } from "./hostname";

/**
 * True only when the RAW Host header names the configured platform host (root domain, `www.<root>`, or - in development and
 * test only - a loopback alias). Store hosts and unknown hosts are both false. Forwarded-host headers are never consulted.
 */
export function isPlatformHostHeader(host: string | null | undefined, policy = getHostPolicy()): boolean {
  return resolveHost(host, policy.rootDomain, policy.aliases).kind === "platform";
}

/**
 * Second line of defence behind the proxy: platform-only pages (dashboard, authentication, preview) answer 404 when reached
 * through a store host OR any unknown host, even if the proxy were somehow bypassed.
 */
export async function assertPlatformHost(): Promise<void> {
  if (!isPlatformHostHeader((await headers()).get("host"))) notFound();
}

/** Same guard for route handlers: returns a 404 response unless the request arrived on the platform host. */
export function platformOnly(req: Request): Response | null {
  return isPlatformHostHeader(req.headers.get("host")) ? null : new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
