import { describe, expect, it } from "vitest";
import { EnvError, loadConfig } from "../config/env.js";

const prod = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:SECRETPW@db:5432/x",
  APP_ROOT_DOMAIN: "example.com",
  APP_PROTOCOL: "https",
  TRUST_PROXY_HOPS: "1",
  AUTH_SECRET: "k3Jx9fQ2vLmZp8RtYw1uB6nCdE4gHs7A",
};

describe("loadConfig", () => {
  it("accepts a complete production configuration", () => {
    const c = loadConfig(prod);
    expect(c.production).toBe(true);
    expect(c.port).toBe(4000);
    expect(c.allowedOrigins).toContain("https://example.com");
  });
  it("defaults development to localhost", () => {
    const c = loadConfig({ NODE_ENV: "development", DATABASE_URL: prod.DATABASE_URL });
    expect(c.rootDomain).toBe("localhost:3000");
    expect(c.production).toBe(false);
  });
  it("refuses production without protocol, domain or proxy hops", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: prod.DATABASE_URL })).toThrow(EnvError);
    expect(() => loadConfig({ ...prod, TRUST_PROXY_HOPS: "0" })).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => loadConfig({ ...prod, APP_PROTOCOL: "http" })).toThrow(/APP_PROTOCOL/);
  });
  it("requires a strong, non-placeholder AUTH_SECRET in production and has a development default", () => {
    expect(() => loadConfig({ ...prod, AUTH_SECRET: undefined })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...prod, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...prod, AUTH_SECRET: "please-change-me-please-change-me-0123456" })).toThrow(/placeholder/);
    expect(loadConfig({ NODE_ENV: "development", DATABASE_URL: prod.DATABASE_URL }).authSecret.length).toBeGreaterThanOrEqual(32);
  });
  it("marks cookies secure only over https", () => {
    expect(loadConfig(prod).secureCookies).toBe(true);
    expect(loadConfig({ ...prod, APP_PROTOCOL: "http", APP_ROOT_DOMAIN: "localhost:3000" }).secureCookies).toBe(false);
  });
  it("allows plain http only on a loopback root", () => {
    expect(loadConfig({ ...prod, APP_PROTOCOL: "http", APP_ROOT_DOMAIN: "localhost:8443" }).protocol).toBe("http");
  });
  it("treats an unknown NODE_ENV as production", () => {
    expect(() => loadConfig({ DATABASE_URL: prod.DATABASE_URL })).toThrow(EnvError);
  });
  it("never puts a value in the error", () => {
    try {
      loadConfig({ ...prod, DATABASE_URL: "mysql://u:SECRETPW@h/x" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRETPW");
      expect((e as Error).message).not.toContain(prod.AUTH_SECRET);
    }
  });
});
