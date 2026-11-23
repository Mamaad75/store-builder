import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production container (Dockerfile copies .next/standalone).
  output: "standalone",
  // pnpm workspace (ADR 0001, N1): trace dependencies from the repository root, so the bundle contains the shared node_modules.
  // The server entry point is then .next/standalone/apps/web/server.js.
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),
  reactStrictMode: true,
  poweredByHeader: false,
  // Development and E2E only: the browser calls the API at /api/* on its own origin. In production Caddy routes these paths straight to
  // the API (docker/caddy/Caddyfile); here Next proxies them. The prefixes are exactly the ones the API serves for the browser.
  async rewrites() {
    const target = process.env.API_DEV_PROXY_URL ?? (process.env.NODE_ENV === "development" ? process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000" : undefined);
    if (!target) return [];
    // Phase 3.1: plus the super admin API (/api/v1/platform), which the /platform pages call from the browser.
    return ["auth", "stores", "public", "v1/platform"].map((p) => ({ source: `/api/${p}/:path*`, destination: `${target}/api/${p}/:path*` }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Draft previews are private: never cached, never indexed.
        source: "/preview/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
