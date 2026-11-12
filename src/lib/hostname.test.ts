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

import { normalizeHostHeader } from "./hostname";

describe("normalizeHostHeader (the raw Host header is the only trusted host input)", () => {
  it.each([
    ["Coffee.LOCALHOST:3000", "coffee.localhost:3000"],
    ["  shop.example.com  ", "shop.example.com"],
    ["shop.example.com.", "shop.example.com"], // one trailing dot
    ["shop.example.com.:8080", "shop.example.com:8080"],
    ["localhost", "localhost"],
    ["[::1]:3000", "[::1]:3000"],
  ])("normalises %j", (raw, out) => {
    expect(normalizeHostHeader(raw)).toBe(out);
  });
  it.each([
    null, undefined, "", " ", "a b", "a,b", "a.localhost, b.localhost", "user@evil.com", "evil.com/path", "evil.com?x=1", "evil.com#x",
    "a%2eb.com", "a\u0000b.com", "a\nb.com", "x".repeat(300), "mystore.localhost:99999", "mystore.localhost:", "..", "-a.com",
  ])("rejects %j", (raw) => {
    expect(normalizeHostHeader(raw as never)).toBeNull();
  });
});

describe("resolveHost: ports, case, dots and hostile input", () => {
  const root = "localhost:3000";
  it("matches the port exactly", () => {
    expect(resolveHost("mystore.localhost:3000", root)).toEqual({ kind: "store", subdomain: "mystore" });
    expect(resolveHost("mystore.localhost:3001", root)).toEqual({ kind: "unknown" });
    expect(resolveHost("mystore.localhost", root)).toEqual({ kind: "unknown" });
    expect(resolveHost("localhost:3001", root)).toEqual({ kind: "unknown" });
  });
  it("is case-insensitive and tolerates one trailing dot", () => {
    expect(resolveHost("MYSTORE.LOCALHOST:3000", root)).toEqual({ kind: "store", subdomain: "mystore" });
    expect(resolveHost("mystore.localhost.:3000", root)).toEqual({ kind: "store", subdomain: "mystore" });
  });
  it("never resolves a store from several values, userinfo, paths or escapes", () => {
    for (const h of ["mystore.localhost:3000, evil.com", "a@mystore.localhost:3000", "mystore.localhost:3000/x", "shop%2elocalhost:3000", "mystore.localhost:3000 evil"]) {
      expect(resolveHost(h, root), h).toEqual({ kind: "unknown" });
    }
  });
});
