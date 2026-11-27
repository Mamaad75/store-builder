import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { StaffBillingService, StoreBillingService } from "./billing.service.js";
import type { BillingRepository } from "./ports.js";

const NOW = new Date("2026-11-27T10:00:00Z");
const NOT_CALLED = () => {
  throw new Error("not expected");
};
function repo(over: Partial<BillingRepository> = {}): BillingRepository {
  return {
    plans: async () => [], createPlan: NOT_CALLED, updatePlan: NOT_CALLED, storeName: async () => "فروشگاه", subscription: async () => null, purchases: async () => [],
    wallet: async () => ({ balanceToman: 0, entries: [] }), referralCode: async () => "ABCDEFGH", referralsMade: async () => [], referredBy: async () => null,
    redeem: NOT_CALLED, recordPurchase: NOT_CALLED, adjustWallet: NOT_CALLED, ...over,
  };
}

describe("StoreBillingService", () => {
  it("reports no subscription, an active one with days left, and the waiting invitation discount", async () => {
    const none = await new StoreBillingService(repo(), () => NOW).overview({ storeId: "s1" });
    expect(none.state).toEqual({ kind: "none" });
    expect(none.referralDiscountPercent).toBe(0);
    const active = await new StoreBillingService(
      repo({ subscription: async () => ({ planId: "p", planName: "ماهانه", startsAt: NOW, endsAt: new Date("2026-12-07T10:00:00Z") }), referredBy: async () => ({ id: "r", status: "PENDING", rewardToman: 0, createdAt: NOW, rewardedAt: null }) }),
      () => NOW,
    ).overview({ storeId: "s1" });
    expect(active.state).toEqual({ kind: "active", daysLeft: 10 });
    expect(active.referralDiscountPercent).toBe(10);
  });
  it("normalises a typed code before asking the repository, and explains every refusal in Persian", async () => {
    let seen = "";
    await new StoreBillingService(repo({ redeem: async (_s, code) => ((seen = code), "ok") })).redeem({ storeId: "s1" }, { code: " ab-cd ef23 " });
    expect(seen).toBe("ABCDEF23");
    for (const refusal of ["unknown_code", "own_code", "same_owner", "already", "has_purchase"] as const) {
      await expect(new StoreBillingService(repo({ redeem: async () => refusal })).redeem({ storeId: "s1" }, { code: "ABCDEF23" })).rejects.toMatchObject({ fieldErrors: { code: [expect.stringMatching(/[؀-ۿ]/)] } });
    }
    await expect(new StoreBillingService(repo()).redeem({ storeId: "s1" }, { code: "bad" })).rejects.toBeInstanceOf(ValidationError); // never reaches the repository
  });
});

describe("StaffBillingService", () => {
  it("validates plans first and audits with the staff member", async () => {
    let audit: unknown;
    const svc = new StaffBillingService(repo({ createPlan: async (_i, _n, a) => ((audit = a), { id: "p1", name: "ماهانه", description: "", priceToman: 1, durationDays: 30, active: true, createdAt: NOW }) }), () => NOW);
    await expect(svc.createPlan("staff1", { name: "x", priceToman: 1, durationDays: 30 })).rejects.toBeInstanceOf(ValidationError);
    expect(audit).toBeUndefined();
    await svc.createPlan("staff1", { name: "ماهانه", priceToman: 100_000, durationDays: 30 });
    expect(audit).toMatchObject({ actorId: "staff1", action: "platform.plan_created", metadata: { priceToman: 100_000 } });
    await expect(new StaffBillingService(repo({ createPlan: async () => "limit" })).createPlan("s", { name: "ماهانه", priceToman: 1, durationDays: 30 })).rejects.toBeInstanceOf(ValidationError);
    await expect(new StaffBillingService(repo({ updatePlan: async () => null })).updatePlan("s", "p1", { name: "ماهانه", priceToman: 1, durationDays: 30 })).rejects.toBeInstanceOf(NotFoundError);
  });
  it("maps the repository's answers for purchases and wallet adjustments", async () => {
    const buy = (r: "no_store" | "no_plan" | "plan_inactive") => new StaffBillingService(repo({ recordPurchase: async () => r })).recordPurchase("s", "st1", { planId: "p1" });
    await expect(buy("no_store")).rejects.toBeInstanceOf(NotFoundError);
    await expect(buy("no_plan")).rejects.toMatchObject({ fieldErrors: { planId: [expect.any(String)] } });
    await expect(buy("plan_inactive")).rejects.toMatchObject({ fieldErrors: { planId: [expect.stringContaining("غیرفعال")] } });
    const adj = (r: "no_store" | "insufficient" | "too_much") => new StaffBillingService(repo({ adjustWallet: async () => r })).adjustWallet("s", "st1", { amountToman: -10, reason: "اصلاح" });
    await expect(adj("insufficient")).rejects.toMatchObject({ fieldErrors: { amountToman: [expect.stringContaining("کافی")] } });
    await expect(adj("too_much")).rejects.toBeInstanceOf(ValidationError);
    await expect(adj("no_store")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new StaffBillingService(repo()).adjustWallet("s", "st1", { amountToman: 0, reason: "اصلاح" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new StaffBillingService(repo()).storeView("../x")).rejects.toBeInstanceOf(NotFoundError);
  });
});
