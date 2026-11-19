import { describe, expect, it } from "vitest";
import { MemoryRateLimiter, rateLimitKey } from "./rate-limit.js";

describe("MemoryRateLimiter", () => {
  it("blocks after the limit and recovers after the window", async () => {
    let now = 0;
    const l = new MemoryRateLimiter(() => now);
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await l.consume("k", rule)).allowed).toBe(true);
    expect((await l.consume("k", rule)).allowed).toBe(true);
    const blocked = await l.consume("k", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await l.consume("other", rule)).allowed).toBe(true);
    now = 61_000;
    expect((await l.consume("k", rule)).allowed).toBe(true);
  });
  it("keys do not contain raw values", () => {
    expect(rateLimitKey("login:username", "victim_user")).not.toContain("victim");
  });
});
