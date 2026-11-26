import { describe, expect, it } from "vitest";
import { VisitService } from "./visit.service.js";
import type { VisitStore } from "./ports.js";

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0 Safari/537.36";
function setup(over: { live?: string | null; allowed?: boolean; now?: string } = {}) {
  const recorded: { storeId: string; day: string; hash: string }[] = [];
  const store: VisitStore = { record: async (storeId, day, hash) => void recorded.push({ storeId, day, hash }) };
  const keys: string[] = [];
  const svc = new VisitService(store, {
    liveStoreId: async () => (over.live === undefined ? "st1" : over.live),
    limiter: { consume: async (k) => (keys.push(k), { allowed: over.allowed ?? true, retryAfterSeconds: 1 }) },
    sha256: (s) => `h(${s})`,
    secret: "SECRET",
    clock: () => new Date(over.now ?? "2026-11-26T10:00:00Z"),
  });
  return { svc, recorded, keys };
}
const ctx = { ip: "1.2.3.4", userAgent: BROWSER, doNotTrack: false };

describe("VisitService.record", () => {
  it("records a view for the live store on the Tehran day, with a keyed hash and no raw address or browser", async () => {
    const { svc, recorded } = setup();
    await svc.record("shop", ctx);
    expect(recorded).toEqual([{ storeId: "st1", day: "2026-11-26", hash: `h(SECRET|2026-11-26|st1|1.2.3.4|${BROWSER})` }]);
  });
  it("the day is the Tehran day: 21:00 UTC is already the next day in Tehran", async () => {
    const { svc, recorded } = setup({ now: "2026-11-26T21:00:00Z" });
    await svc.record("shop", ctx);
    expect(recorded[0]!.day).toBe("2026-11-27");
  });
  it("does nothing, and says nothing, for an unlisted store, a bot, Do Not Track, a bad label or an exhausted limit", async () => {
    for (const [o, c, label] of [
      [{ live: null }, ctx, "shop"],
      [{}, { ...ctx, userAgent: "Googlebot/2.1" }, "shop"],
      [{}, { ...ctx, doNotTrack: true }, "shop"],
      [{}, ctx, "Bad Label!"],
      [{ allowed: false }, ctx, "shop"],
    ] as const) {
      const { svc, recorded } = setup(o);
      await expect(svc.record(label, c)).resolves.toBeUndefined();
      expect(recorded).toEqual([]);
    }
  });
  it("rate-limits per store and per hashed network (the raw address is not a key)", async () => {
    const { svc, keys } = setup();
    await svc.record("shop", ctx);
    expect(keys).toEqual(["visit:st1:h(1.2.3.4)"]);
  });
});
