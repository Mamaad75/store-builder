import { describe, expect, it } from "vitest";
import { getClientIp } from "@/lib/client-ip";

describe("getClientIp", () => {
  it("ignores forwarding headers unless the proxy is explicitly trusted", () => {
    const h = { get: (n: string) => (n === "x-forwarded-for" ? "6.6.6.6" : null) };
    expect(getClientIp(h, {})).toBe("unknown");
    expect(getClientIp(h, { TRUST_PROXY_HEADERS: "false" })).toBe("unknown");
  });
  it("counts X-Forwarded-For from the right so client-supplied entries cannot pick the bucket", () => {
    const h = (v: string | null) => ({ get: (n: string) => (n === "x-forwarded-for" ? v : null) });
    const on = { TRUST_PROXY_HEADERS: "true" };
    // client spoofed 6.6.6.6; the trusted proxy appended the real address
    expect(getClientIp(h("6.6.6.6, 203.0.113.7"), on)).toBe("203.0.113.7");
    expect(getClientIp(h("203.0.113.7"), on)).toBe("203.0.113.7");
    // two trusted proxies (e.g. CDN + load balancer)
    expect(getClientIp(h("6.6.6.6, 203.0.113.7, 10.0.0.2"), { ...on, TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.7");
    expect(getClientIp(h("2001:db8::1"), on)).toBe("2001:db8::1");
  });
  it("falls back to unknown for missing, malformed or too-short headers", () => {
    const h = (v: string | null) => ({ get: (n: string) => (n === "x-forwarded-for" ? v : null) });
    const on = { TRUST_PROXY_HEADERS: "true" };
    expect(getClientIp(h(null), on)).toBe("unknown");
    expect(getClientIp(h("not-an-ip"), on)).toBe("unknown");
    expect(getClientIp(h("1.2.3.4"), { ...on, TRUSTED_PROXY_HOPS: "2" })).toBe("unknown");
    expect(getClientIp(h("1.2.3.4"), { ...on, TRUSTED_PROXY_HOPS: "0" })).toBe("unknown");
  });
});
