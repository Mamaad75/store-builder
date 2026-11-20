import { describe, expect, it } from "vitest";
import { BullMqEventPublisher, DELIVERY, dispatch, toEnvelope, type EventEnvelope } from "./event-queue.js";

const claimed = { id: "ckabc123", type: "store.published", storeId: "s1", payload: { versionId: "v1" }, occurredAt: new Date("2026-11-20T10:00:00Z"), attempts: 1 };
const hooks = (logs: string[]) => ({ log: { info: (e: string) => void logs.push(e), error: (e: string) => void logs.push(e) } });

describe("event queue (no Valkey needed)", () => {
  it("publishes with the outbox id as job id (duplicate adds are ignored by the queue) and the delivery policy", async () => {
    const added: { name: string; data: unknown; opts: Record<string, unknown> }[] = [];
    const queue = { add: async (name: string, data: unknown, opts: Record<string, unknown>) => void added.push({ name, data, opts }) };
    await new BullMqEventPublisher(queue as never).publish(claimed);
    expect(added).toHaveLength(1);
    expect(added[0]!.name).toBe("store.published");
    expect(added[0]!.data).toEqual({ id: "ckabc123", type: "store.published", storeId: "s1", payload: { versionId: "v1" }, occurredAt: "2026-11-20T10:00:00.000Z" });
    expect(added[0]!.opts).toMatchObject({ jobId: "ckabc123", attempts: DELIVERY.attempts, removeOnComplete: { age: DELIVERY.keepCompletedSeconds } });
  });

  it("dispatches to the handler of the job's type; an unknown type is acknowledged and logged", async () => {
    const seen: EventEnvelope[] = [];
    const logs: string[] = [];
    const data = toEnvelope(claimed);
    await dispatch({ "store.published": async (e) => void seen.push(e) }, { name: "store.published", data }, hooks(logs));
    expect(seen).toEqual([data]);
    await dispatch({}, { name: "order.paid", data }, hooks(logs));
    expect(logs).toEqual(["event.unhandled"]);
  });

  it("a handler failure propagates (so the queue retries it)", async () => {
    const boom = { "store.published": async () => { throw new Error("boom"); } };
    await expect(dispatch(boom, { name: "store.published", data: toEnvelope(claimed) }, hooks([]))).rejects.toThrow("boom");
  });
});
