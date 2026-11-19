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
  // Image uploads travel through Server Actions: 5 MB file + multipart overhead (the pipeline enforces the real limit).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
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
