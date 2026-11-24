import { describe, expect, it } from "vitest";
import { storeAvailability } from "./availability.js";

describe("storeAvailability (ADR 0003 §0.2)", () => {
  const f = (published: boolean, adminSuspended: boolean, billingRestricted: boolean) => storeAvailability({ published, adminSuspended, billingRestricted });

  it("is live only when every condition allows it", () => {
    for (const p of [true, false]) for (const a of [true, false]) for (const b of [true, false]) {
      const r = f(p, a, b);
      expect(r.storefrontLive).toBe(p && !a && !b);
      expect(r.newBusiness).toBe(r.storefrontLive);
      expect(r.orderAccess).toBe(true); // shoppers always keep their orders
      expect(r.prepaidActions).toBe(!a); // only an administrative suspension stops paying for existing orders
    }
  });

  it("no condition can override another", () => {
    expect(f(true, true, false).storefrontLive).toBe(false); // publishing never bypasses a suspension
    expect(f(true, false, true).storefrontLive).toBe(false); // lifting the suspension never lifts billing
    expect(f(false, false, false).storefrontLive).toBe(false); // nor publishes an unpublished store
    expect(f(false, false, false).prepaidActions).toBe(true); // an unpublished store's shoppers can still pay their orders
  });
});
