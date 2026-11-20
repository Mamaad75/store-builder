import { describe, expect, it } from "vitest";
import { RELAY_DEFAULTS, failureReason, relayOnce, retryDelayMs, type ClaimedEvent, type OutboxStore, type RelayDeps } from "./relay.js";

const event = (id: string, attempts = 1): ClaimedEvent => ({ id, type: "store.published", storeId: "s1", payload: { n: 1 }, occurredAt: new Date(0), attempts });

function fakes(batch: ClaimedEvent[], failIds: string[] = [], err: Error = new Error("connect ECONNREFUSED redis://:pw@10.0.0.5:6379")) {
  const calls = { published: [] as string[], failed: [] as { id: string; retryInMs: number; reason: string }[], alerts: [] as string[], logs: [] as string[] };
  const store: OutboxStore = {
    claim: async () => batch,
    markPublished: async (id) => void calls.published.push(id),
    markFailed: async (id, retryInMs, reason) => void calls.failed.push({ id, retryInMs, reason }),
  };
  const deps: RelayDeps = {
    store,
    publisher: { publish: async (e) => { if (failIds.includes(e.id)) throw err; } },
    log: { info: (e) => void calls.logs.push(e), error: (e, f) => void calls.logs.push(`${e} ${JSON.stringify(f)}`) },
    alert: async (e) => void calls.alerts.push(e),
  };
  return { deps, calls };
}

describe("outbox relay", () => {
  it("publishes every claimed event and stamps it; one failure does not stop the batch", async () => {
    const { deps, calls } = fakes([event("a"), event("b"), event("c")], ["b"]);
    expect(await relayOnce(deps)).toEqual({ claimed: 3, published: 2, failed: 1 });
    expect(calls.published).toEqual(["a", "c"]);
    expect(calls.failed.map((f) => f.id)).toEqual(["b"]);
  });

  it("a failure is rescheduled with backoff and a reason that never carries the error message (hosts, passwords)", async () => {
    const { deps, calls } = fakes([event("b", 3)], ["b"]);
    await relayOnce(deps);
    expect(calls.failed[0]).toEqual({ id: "b", retryInMs: 4_000, reason: "publish_failed:Error" });
    expect(calls.logs.join("\n")).not.toMatch(/ECONNREFUSED|pw@|10\.0\.0\.5/);
  });

  it("backoff doubles per attempt and is capped at five minutes", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(retryDelayMs(30)).toBe(5 * 60_000);
    expect(retryDelayMs(0)).toBe(1_000);
  });

  it("alerts exactly once, when an event reaches the alert threshold (it keeps being retried)", async () => {
    for (const attempts of [RELAY_DEFAULTS.alertAtAttempts - 1, RELAY_DEFAULTS.alertAtAttempts, RELAY_DEFAULTS.alertAtAttempts + 1]) {
      const { deps, calls } = fakes([event("x", attempts)], ["x"]);
      await relayOnce(deps);
      expect(calls.alerts, `attempts ${attempts}`).toEqual(attempts === RELAY_DEFAULTS.alertAtAttempts ? ["outbox.stuck"] : []);
    }
  });

  it("an empty claim does nothing and logs nothing", async () => {
    const { deps, calls } = fakes([]);
    expect(await relayOnce(deps)).toEqual({ claimed: 0, published: 0, failed: 0 });
    expect(calls.logs).toEqual([]);
  });

  it("failure reasons are bounded and class-only", () => {
    class VeryLongNamedError extends Error {
      override name = "X".repeat(500);
    }
    expect(failureReason(new VeryLongNamedError("secret")).length).toBe(200);
    expect(failureReason("plain string")).toBe("publish_failed:UnknownError");
  });
});
