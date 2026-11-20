import { describe, expect, it } from "vitest";
import { formatLog, redact } from "./log.js";

const T = () => new Date("2026-01-01T00:00:00.000Z");

describe("structured log lines", () => {
  it("is one parseable JSON object with timestamp, level and event", () => {
    const line = formatLog("warn", "x.happened", { storeId: "s1", count: 3 }, T);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ ts: "2026-01-01T00:00:00.000Z", level: "warn", event: "x.happened", storeId: "s1", count: 3 });
  });
  it("redacts by key name, at any depth, and never prints an Error message or stack", () => {
    const out = JSON.parse(formatLog("error", "e", { password: "p", nested: { resetToken: "t", resetLink: "http://x", email: "a@b.c", ok: 1 }, err: new Error("secret in message"), authorization: "Bearer x" }, T));
    expect(out.password).toBe("[redacted]");
    expect(out.nested).toEqual({ resetToken: "[redacted]", resetLink: "[redacted]", email: "[redacted]", ok: 1 });
    expect(out.err).toEqual({ name: "Error" });
    expect(out.authorization).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toMatch(/secret in message|Bearer|a@b\.c/);
  });
  it("callers cannot spoof the reserved fields, and long strings and deep objects are bounded", () => {
    const out = JSON.parse(formatLog("info", "real", { ts: "x", level: "error", event: "fake", long: "a".repeat(2000), deep: { a: { b: { c: { d: 1 } } } } }, T));
    expect(out).toMatchObject({ level: "info", event: "real", ts: "2026-01-01T00:00:00.000Z" });
    expect(out.long.length).toBeLessThan(600);
    expect(JSON.stringify(out.deep)).toContain("[depth]");
  });
  it("redact leaves primitives and null alone", () => {
    expect(redact(null)).toBeNull();
    expect(redact(5)).toBe(5);
    expect(redact(true)).toBe(true);
  });
});
