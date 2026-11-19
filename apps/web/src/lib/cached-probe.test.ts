import { describe, expect, it } from "vitest";
import { createCachedProbe } from "./cached-probe";

/** Regression for the phase 13 review finding: every public /api/ready request used to run a DB query AND a billed S3 LIST. */
function setup(results: string[] = ["a", "b", "c"]) {
  let t = 0;
  let calls = 0;
  const pending: (() => void)[] = [];
  const probe = () =>
    new Promise<string>((resolve) => {
      const value = results[calls++] ?? "x";
      pending.push(() => resolve(value));
    });
  const get = createCachedProbe(probe, { ttlMs: 5_000, now: () => t });
  return {
    get,
    calls: () => calls,
    settle: () => pending.splice(0).forEach((r) => r()),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createCachedProbe (readiness throttling)", () => {
  it("100 concurrent requests share ONE probe and all get its result", async () => {
    const s = setup();
    const all = Array.from({ length: 100 }, () => s.get());
    expect(s.calls()).toBe(1);
    s.settle();
    expect(new Set(await Promise.all(all))).toEqual(new Set(["a"]));
  });

  it("a finished result is reused within the TTL, and a new probe runs only after it", async () => {
    const s = setup();
    const first = s.get();
    s.settle();
    expect(await first).toBe("a");
    s.advance(4_999);
    expect(await s.get()).toBe("a");
    expect(s.calls()).toBe(1);
    s.advance(1);
    const second = s.get();
    expect(s.calls()).toBe(2);
    s.settle();
    expect(await second).toBe("b");
  });

  it("a rejected probe is not cached: the next request probes again", async () => {
    let n = 0;
    const get = createCachedProbe(() => (n++ === 0 ? Promise.reject(new Error("boom")) : Promise.resolve("ok")), { ttlMs: 5_000, now: () => 0 });
    await expect(get()).rejects.toThrow("boom");
    expect(await get()).toBe("ok");
    expect(n).toBe(2);
  });
});
