import { describe, expect, it } from "vitest";
import { OTP, challengeState, parseCode, resendWait } from "./otp.js";

describe("OTP rules (phase 3.1)", () => {
  it("parses a typed code (Persian digits, spaces) and refuses anything else", () => {
    expect(parseCode("123456")).toBe("123456");
    expect(parseCode("۱۲۳ ۴۵۶")).toBe("123456");
    for (const bad of ["12345", "1234567", "12a456", "", " ", 123456, null, "1".repeat(30)]) expect(parseCode(bad as never), String(bad)).toBeNull();
  });
  it("a challenge is usable only before expiry, unconsumed and with tries left", () => {
    const now = new Date("2026-01-01T00:01:00Z");
    const base = { createdAt: new Date("2026-01-01T00:00:00Z"), expiresAt: new Date("2026-01-01T00:02:00Z"), consumedAt: null, attempts: 0 };
    expect(challengeState(base, now)).toBe("usable");
    expect(challengeState({ ...base, expiresAt: now }, now)).toBe("expired");
    expect(challengeState({ ...base, consumedAt: now }, now)).toBe("consumed");
    expect(challengeState({ ...base, attempts: OTP.maxAttempts }, now)).toBe("exhausted");
  });
  it("rate-limit keys: IPv4 as is, IPv6 by its /64 (one subscriber cannot rotate addresses)", async () => {
    const { ipLimitKey } = await import("./otp.js");
    expect(ipLimitKey("10.1.2.3")).toBe("10.1.2.3");
    expect(ipLimitKey("::ffff:10.1.2.3")).toBe("10.1.2.3");
    expect(ipLimitKey("2a01:5ec0:1000:0001:aaaa::1")).toBe("2a01:5ec0:1000:1::/64");
    expect(ipLimitKey("2a01:5ec0:1000:1:ffff:ffff:ffff:ffff")).toBe("2a01:5ec0:1000:1::/64");
    expect(ipLimitKey("2a01:5ec0::1")).toBe("2a01:5ec0:0:0::/64");
  });
  it("a new code waits a minute after the last one", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    expect(resendWait(null, t)).toBe(0);
    expect(resendWait(t, new Date(t.getTime() + 15_000))).toBe(45);
    expect(resendWait(t, new Date(t.getTime() + 61_000))).toBe(0);
  });
});
