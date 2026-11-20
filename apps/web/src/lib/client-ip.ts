import { isIP } from "node:net";

/**
 * Client IP for rate limiting.
 *
 * Client-supplied forwarding headers are never trusted by default: unless TRUST_PROXY_HEADERS=true
 * every request maps to the shared "unknown" bucket (the per-username limit still applies).
 *
 * When enabled, the IP is taken from X-Forwarded-For counting from the RIGHT: each trusted proxy
 * appends the address it saw, so with N trusted proxies the real client is the N-th entry from the
 * end (TRUSTED_PROXY_HOPS, default 1). Entries further left are client-controlled and ignored,
 * so a spoofed header cannot choose the rate-limit bucket even if a proxy appends instead of
 * overwriting. See docs/deployment.md.
 */
export function getClientIp(
  headers: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.TRUST_PROXY_HEADERS !== "true") return "unknown";
  const hops = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "1", 10);
  if (!Number.isInteger(hops) || hops < 1) return "unknown";
  const entries = (headers.get("x-forwarded-for") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const candidate = entries[entries.length - hops];
  return candidate && isIP(candidate) ? candidate : "unknown";
}
