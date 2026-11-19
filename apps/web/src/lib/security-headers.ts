/**
 * Response security headers applied to EVERY platform and storefront response by the proxy (src/proxy.ts), computed per request
 * from runtime configuration (so one built image works with any S3_PUBLIC_BASE_URL / protocol).
 *
 * CSP (production only; `next dev` needs eval and websockets):
 *   - scripts: 'self' + 'unsafe-inline'. Next.js inlines its bootstrap/hydration scripts, and a nonce would force every page (including the
 *     prerendered landing page) to render dynamically on each request. This is a KNOWN, accepted weakness (decision D13-5): XSS is
 *     prevented first by escaping everywhere (architecture guards ban raw HTML injection except the escaped JSON-LD component).
 *   - styles: 'unsafe-inline' (MUI/emotion injects style tags).
 *   - images: 'self', data:, blob: and the media origin (S3_PUBLIC_BASE_URL): the only external origin a page may load anything from.
 *   - no plugins (object-src), no <base> hijack, forms only to self, framing only by the same origin, no other connections.
 * HSTS only when the platform is configured for https (never over http, where browsers ignore or it would lock out dev hosts).
 */
export interface SecurityEnv {
  NODE_ENV?: string;
  APP_PROTOCOL?: string;
  S3_PUBLIC_BASE_URL?: string;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function buildCsp(env: SecurityEnv): string | null {
  if (env.NODE_ENV !== "production") return null;
  const media = originOf(env.S3_PUBLIC_BASE_URL);
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${media ? ` ${media}` : ""}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];
  if (env.APP_PROTOCOL === "https") directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

export function securityHeaders(env: SecurityEnv): Record<string, string> {
  const h: Record<string, string> = {
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  const csp = buildCsp(env);
  if (csp) h["Content-Security-Policy"] = csp;
  if (env.NODE_ENV === "production" && env.APP_PROTOCOL === "https") h["Strict-Transport-Security"] = HSTS_VALUE;
  return h;
}
