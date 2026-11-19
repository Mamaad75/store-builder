import { describe, expect, it } from "vitest";
import { isPlatformHostHeader } from "./host-guard";
import { getHostPolicy } from "./host-policy";
import { platformAliases, resolveHost } from "./hostname";

describe("platformAliases: loopback names exist only in explicit development and test environments", () => {
  it("production, staging, unset and misspelled environments get NO aliases (strict)", () => {
    for (const env of ["production", "staging", undefined, "", "Production", "prod", "developmen"]) {
      expect(platformAliases("localhost:3000", env), String(env)).toEqual([]);
      expect(platformAliases("shop.example.com", env), String(env)).toEqual([]);
    }
  });
  it("development and test get the loopback names with the root domain's port", () => {
    for (const env of ["development", "test"]) {
      expect(platformAliases("localhost:3000", env)).toEqual(["127.0.0.1:3000", "[::1]:3000"]); // localhost:3000 is the root itself
      expect(platformAliases("example.test", env)).toEqual(["localhost", "127.0.0.1", "[::1]"]);
      expect(platformAliases("example.test:8443", env)).toEqual(["localhost:8443", "127.0.0.1:8443", "[::1]:8443"]);
    }
  });
});

describe("getHostPolicy reads APP_ROOT_DOMAIN and NODE_ENV only", () => {
  it("production: the configured root domain and nothing else", () => {
    const p = getHostPolicy({ NODE_ENV: "production", APP_ROOT_DOMAIN: "shops.example.com" } as NodeJS.ProcessEnv);
    expect(p).toEqual({ rootDomain: "shops.example.com", aliases: [] });
    expect(resolveHost("shops.example.com", p.rootDomain, p.aliases)).toEqual({ kind: "platform" });
    expect(resolveHost("www.shops.example.com", p.rootDomain, p.aliases)).toEqual({ kind: "platform" });
    expect(resolveHost("coffee.shops.example.com", p.rootDomain, p.aliases)).toEqual({ kind: "store", subdomain: "coffee" });
    for (const h of ["localhost", "localhost:3000", "127.0.0.1", "203.0.113.7", "evil.com", "shops.example.com.evil.com", "shops.example.com:8443", "a.coffee.shops.example.com", "example.com"]) {
      expect(resolveHost(h, p.rootDomain, p.aliases), h).toEqual({ kind: "unknown" });
    }
  });
  it("development: the default localhost:3000 root plus loopback aliases", () => {
    const p = getHostPolicy({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(p.rootDomain).toBe("localhost:3000");
    expect(resolveHost("127.0.0.1:3000", p.rootDomain, p.aliases)).toEqual({ kind: "platform" });
    expect(resolveHost("127.0.0.1:3001", p.rootDomain, p.aliases)).toEqual({ kind: "unknown" });
  });
});

describe("isPlatformHostHeader (guard behind the proxy)", () => {
  const prod = { rootDomain: "shops.example.com", aliases: [] };
  it("accepts only the platform host; store hosts and unknown hosts are rejected", () => {
    expect(isPlatformHostHeader("shops.example.com", prod)).toBe(true);
    expect(isPlatformHostHeader("www.shops.example.com", prod)).toBe(true);
    expect(isPlatformHostHeader("coffee.shops.example.com", prod)).toBe(false);
    expect(isPlatformHostHeader("evil.com", prod)).toBe(false);
    expect(isPlatformHostHeader("127.0.0.1", prod)).toBe(false);
    expect(isPlatformHostHeader(null, prod)).toBe(false);
  });
});
