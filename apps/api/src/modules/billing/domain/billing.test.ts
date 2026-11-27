import { describe, expect, it } from "vitest";
import { REDEEM_MESSAGES, stateOf } from "./billing.js";

describe("billing domain", () => {
  it("has a Persian sentence for every refusal of a referral code", () => {
    for (const m of Object.values(REDEEM_MESSAGES)) expect(m).toMatch(/[؀-ۿ]/);
    expect(Object.keys(REDEEM_MESSAGES).sort()).toEqual(["already", "has_purchase", "own_code", "same_owner", "unknown_code"]);
  });
  it("reads the subscription state from its end date", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(stateOf(null, now).kind).toBe("none");
    expect(stateOf(new Date("2026-11-20T00:00:00Z"), now)).toEqual({ kind: "active", daysLeft: 19 });
    expect(stateOf(new Date("2026-10-20T00:00:00Z"), now).kind).toBe("expired");
  });
});
