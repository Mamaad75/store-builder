import { describe, expect, it } from "vitest";
import { EnvError, loadConfig } from "../config/env.js";

const prod = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:SECRETPW@db:5432/x",
  APP_ROOT_DOMAIN: "example.com",
  APP_PROTOCOL: "https",
  TRUST_PROXY_HOPS: "1",
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
    }
  });
});
