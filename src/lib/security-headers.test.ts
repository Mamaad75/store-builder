import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "./security-headers";

const PROD = { NODE_ENV: "production", APP_PROTOCOL: "https", S3_PUBLIC_BASE_URL: "https://media.example.net/bucket/" };

describe("Content-Security-Policy", () => {
  it("is production-only (next dev needs eval and websockets)", () => {
    expect(buildCsp({ NODE_ENV: "development" })).toBeNull();
    expect(buildCsp({})).toBeNull();
    expect(securityHeaders({ NODE_ENV: "test" })["Content-Security-Policy"]).toBeUndefined();
  });
  it("allows the media ORIGIN (not the path) for images, and no other external origin anywhere", () => {
    const csp = buildCsp(PROD)!;
    expect(csp).toContain("img-src 'self' data: blob: https://media.example.net;");
    expect(csp).not.toContain("/bucket");
    expect([...csp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0])).toEqual(["https://media.example.net"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });
  it("blocks plugins, base-tag hijacking, foreign form targets and foreign framing", () => {
    const csp = buildCsp(PROD)!;
    for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) expect(csp).toContain(d);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/\*/);
  });
  it("a missing or malformed media URL adds no origin (and never throws)", () => {
    for (const S3_PUBLIC_BASE_URL of [undefined, "", "not a url", "javascript:alert(1)", "ftp://x/y"]) {
      const csp = buildCsp({ NODE_ENV: "production", S3_PUBLIC_BASE_URL })!;
      expect(csp, String(S3_PUBLIC_BASE_URL)).toContain("img-src 'self' data: blob:;");
    }
  });
  it("upgrades insecure requests only when the platform is https", () => {
    expect(buildCsp(PROD)).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...PROD, APP_PROTOCOL: "http" })).not.toContain("upgrade-insecure-requests");
  });
});

describe("HSTS and the other platform headers", () => {
  it("HSTS only in production over https, covering sub-domains (store hosts), never preloaded", () => {
    expect(securityHeaders(PROD)["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(securityHeaders({ ...PROD, APP_PROTOCOL: "http" })["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders({ ...PROD, NODE_ENV: "development" })["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders(PROD)["Strict-Transport-Security"]).not.toContain("preload");
  });
  it("always sets a restrictive Permissions-Policy and COOP", () => {
    const h = securityHeaders({ NODE_ENV: "development" });
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });
});
