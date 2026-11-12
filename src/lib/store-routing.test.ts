import { describe, expect, it } from "vitest";
import { platformAliases } from "./hostname";
import { STORE_ROUTE_PREFIX, decideRoute, isSafeStorePath } from "./store-routing";

const root = "localhost:3000";

describe("decideRoute", () => {
  it("the configured platform host (root domain and www) gets normal handling", () => {
    for (const host of ["localhost:3000", "www.localhost:3000", "LOCALHOST:3000"]) {
      expect(decideRoute(host, "/dashboard", root), host).toEqual({ kind: "platform" });
    }
  });

  it("UNKNOWN hosts get the neutral 404 for every path: foreign domains, IP hosts, nested labels, wrong ports, missing or malformed Host", () => {
    const unknown = [
      "evil.com", "evil.com:3000", "127.0.0.1:3000", "127.0.0.1", "[::1]:3000", "10.0.0.5:3000", "localhost", "localhost:3001", "localhost:3000.evil.com",
      "a.mystore.localhost:3000", "mystore.localhost:3001", "mystore.localhost", "admin.localhost:3000", "mystore.localhost.evil.com",
      "mystore.localhost:3000, evil.com", "user@localhost:3000", null, undefined, "",
    ];
    for (const host of unknown) {
      for (const p of ["/", "/dashboard", "/login", "/api/health", "/api/auth/session", "/preview/x", "/products/a"]) {
        expect(decideRoute(host, p, root), `${String(host)} ${p}`).toEqual({ kind: "not_found" });
      }
    }
  });

  it("loopback aliases are platform hosts only when explicitly passed (development/test) and are never store hosts", () => {
    const aliases = platformAliases(root, "development");
    expect(decideRoute("127.0.0.1:3000", "/dashboard", root, aliases)).toEqual({ kind: "platform" });
    expect(decideRoute("127.0.0.1:3000", "/dashboard", root)).toEqual({ kind: "not_found" });
    expect(decideRoute("127.0.0.1:3001", "/dashboard", root, aliases)).toEqual({ kind: "not_found" });
    expect(decideRoute("evil.com", "/dashboard", root, aliases)).toEqual({ kind: "not_found" });
  });

  it("the internal namespace is NEVER reachable on a platform or unknown host", () => {
    for (const host of ["localhost:3000", "evil.com", null]) {
      for (const p of [STORE_ROUTE_PREFIX, `${STORE_ROUTE_PREFIX}/shop`, `${STORE_ROUTE_PREFIX}/shop/products`]) {
        expect(decideRoute(host, p, root), `${host} ${p}`).toEqual({ kind: "not_found" });
      }
    }
  });

  it("on a store host EVERY path is a storefront path (dashboard, login, api, preview and the namespace itself are just unknown pages)", () => {
    for (const p of ["/", "/products", "/about", "/dashboard", "/dashboard/stores/x", "/login", "/register", "/api/auth/session", "/api/health", "/preview/abc", `${STORE_ROUTE_PREFIX}/other/x`]) {
      expect(decideRoute("mystore.localhost:3000", p, root), p).toEqual({ kind: "store", label: "mystore", path: p, productSlug: null });
    }
  });

  it("extracts the product slug of /products/<slug> (decoded)", () => {
    expect(decideRoute("mystore.localhost:3000", "/products/%DA%A9%D8%AA%D8%B1%DB%8C", root)).toMatchObject({ kind: "store", productSlug: "کتری" });
    expect(decideRoute("mystore.localhost:3000", "/products/a-b", root)).toMatchObject({ productSlug: "a-b" });
    expect(decideRoute("mystore.localhost:3000", "/products", root)).toMatchObject({ productSlug: null });
    expect(decideRoute("mystore.localhost:3000", "/products/a/b", root)).toMatchObject({ productSlug: null });
  });

  it("path traversal, encoded separators, NUL, backslashes, double slashes and bad encodings are the neutral 404", () => {
    for (const p of ["/../dashboard", "/products/../dashboard", "/products/%2e%2e/%2e%2e/api/auth/session", "/%2e%2e/login", "/a%2fb", "/a%5cb", "/a\\b", "//dashboard", "/products//x", "/x%00y", "/products/%E0%A4%A", "/%2E%2E/x", "/a/./b", "/a%252fb"]) {
      expect(decideRoute("mystore.localhost:3000", p, root), p).toEqual({ kind: "not_found" });
    }
  });

  it("forwarded-host style spoofing cannot be expressed: only the Host argument exists", () => {
    // the function takes the raw Host only; a platform Host with a store-looking path stays platform
    expect(decideRoute("localhost:3000", "/products/x", root)).toEqual({ kind: "platform" });
  });
});

describe("isSafeStorePath", () => {
  it("accepts ordinary paths", () => {
    for (const p of ["/", "/products", "/products/%D8%A7", "/about", "/contact", "/products?x"]) expect(isSafeStorePath(p.split("?")[0]!), p).toBe(true);
  });
  it("rejects relative or oversized paths", () => {
    expect(isSafeStorePath("products")).toBe(false);
    expect(isSafeStorePath(`/${"a".repeat(600)}`)).toBe(false);
  });
});
