import { describe, expect, it } from "vitest";
import { formatLog } from "../logging/json-logger.js";

describe("formatLog", () => {
  it("redacts sensitive keys and reduces errors to their class", () => {
    const line = JSON.parse(formatLog("error", "x", { password: "p", nested: { authorization: "Bearer a", ok: 1 }, err: new TypeError("secret msg") }));
    expect(line.password).toBe("[redacted]");
    expect(line.nested.authorization).toBe("[redacted]");
    expect(line.nested.ok).toBe(1);
    expect(line.err).toEqual({ name: "TypeError" });
  });
  it("cannot be overridden by caller fields", () => {
    const line = JSON.parse(formatLog("info", "real", { event: "fake", level: "error", ts: "x" }));
    expect(line.event).toBe("real");
    expect(line.level).toBe("info");
  });
});
