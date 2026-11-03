import { describe, expect, it } from "vitest";
import { resolveHost, validateSubdomain } from "./hostname";

describe("validateSubdomain", () => {
  it("accepts and lowercases valid names", () => {
    expect(validateSubdomain(" Coffee-Shop ")).toEqual({ ok: true, value: "coffee-shop" });
  });
  it.each(["a", "-abc", "abc-", "a_b", "a.b", "ab--cd", "x".repeat(31), "فروشگاه"])("rejects %s", (v) => {
    expect(validateSubdomain(v)).toEqual({ ok: false, reason: "invalid" });
  });
  it("rejects reserved names", () => {
    expect(validateSubdomain("admin")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSubdomain("WWW")).toEqual({ ok: false, reason: "reserved" });
  });
});

describe("resolveHost", () => {
  const root = "localhost:3000";
  it("resolves the platform host", () => {
    expect(resolveHost("localhost:3000", root)).toEqual({ kind: "platform" });
  });
  it("resolves store subdomains", () => {
    expect(resolveHost("coffee.localhost:3000", root)).toEqual({ kind: "store", subdomain: "coffee" });
    expect(resolveHost("Coffee.Example.com", "example.com")).toEqual({ kind: "store", subdomain: "coffee" });
  });
  it("treats unrelated, nested, reserved or missing hosts as unknown", () => {
    expect(resolveHost("evil.com", root)).toEqual({ kind: "unknown" });
    expect(resolveHost("a.b.localhost:3000", root)).toEqual({ kind: "unknown" });
    expect(resolveHost("admin.localhost:3000", root)).toEqual({ kind: "unknown" });
    expect(resolveHost("notlocalhost:3000", root)).toEqual({ kind: "unknown" });
    expect(resolveHost(null, root)).toEqual({ kind: "unknown" });
  });
});
