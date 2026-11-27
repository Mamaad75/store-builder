import { describe, expect, it } from "vitest";
import { MAX_PRICE_TOMAN } from "../../lib/money.js";
import { planLimitMessage } from "./errors.js";
import { FREE_LIMITS, effectiveLimits, REFERRAL_ALPHABET, normalizeReferralCode, nextPeriod, percentOf, planInputSchema, quotePurchase, referralCodeFrom, subscriptionState, walletAdjustSchema } from "./billing.js";

describe("quotePurchase", () => {
  it("a plain purchase: no discount, no reward, cash is the price", () => {
    expect(quotePurchase({ price: 500_000, invited: false, walletBalance: 0, useWallet: false })).toEqual({ price: 500_000, discount: 0, due: 500_000, walletUsed: 0, cash: 500_000, reward: 0 });
  });
  it("the invited store pays 10% less and the inviter earns 10% of what was paid for", () => {
    expect(quotePurchase({ price: 500_000, invited: true, walletBalance: 0, useWallet: false })).toEqual({ price: 500_000, discount: 50_000, due: 450_000, walletUsed: 0, cash: 450_000, reward: 45_000 });
  });
  it("whole Toman only: fractions round down", () => {
    const q = quotePurchase({ price: 99_999, invited: true, walletBalance: 0, useWallet: false });
    expect(q.discount).toBe(9_999);
    expect(q.due).toBe(90_000);
    expect(q.reward).toBe(9_000);
    expect(percentOf(7, 10)).toBe(0);
  });
  it("the wallet pays up to the balance and never more than is due", () => {
    expect(quotePurchase({ price: 100_000, invited: false, walletBalance: 30_000, useWallet: true })).toMatchObject({ walletUsed: 30_000, cash: 70_000 });
    expect(quotePurchase({ price: 100_000, invited: false, walletBalance: 500_000, useWallet: true })).toMatchObject({ walletUsed: 100_000, cash: 0 });
    expect(quotePurchase({ price: 100_000, invited: false, walletBalance: 500_000, useWallet: false })).toMatchObject({ walletUsed: 0, cash: 100_000 });
  });
  it("the reward counts the whole purchase even when the wallet paid for it", () => {
    expect(quotePurchase({ price: 200_000, invited: true, walletBalance: 1_000_000, useWallet: true })).toMatchObject({ due: 180_000, walletUsed: 180_000, cash: 0, reward: 18_000 });
  });
  it("a free plan never uses up an invitation and pays no reward", () => {
    expect(quotePurchase({ price: 0, invited: true, walletBalance: 0, useWallet: true })).toEqual({ price: 0, discount: 0, due: 0, walletUsed: 0, cash: 0, reward: 0 });
  });
  it("the pieces always add up", () => {
    for (const price of [1, 9, 10, 11, 99, 12_345, 1_000_000_000]) for (const invited of [false, true]) for (const bal of [0, 5, 1e6]) {
      const q = quotePurchase({ price, invited, walletBalance: bal, useWallet: true });
      expect(q.price - q.discount).toBe(q.due);
      expect(q.walletUsed + q.cash).toBe(q.due);
      expect(q.walletUsed).toBeLessThanOrEqual(bal);
    }
  });
});

describe("periods and state", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("starts now, or after a period that is still running", () => {
    expect(nextPeriod(null, now, 30).endsAt).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(nextPeriod(new Date("2026-10-01T00:00:00Z"), now, 30).startsAt).toEqual(now); // expired: starts now
    const running = new Date("2026-11-11T00:00:00Z");
    expect(nextPeriod(running, now, 30)).toEqual({ startsAt: running, endsAt: new Date("2026-12-11T00:00:00Z") });
  });
  it("tells none, active (days left rounded up) and expired", () => {
    expect(subscriptionState(null, now)).toEqual({ kind: "none" });
    expect(subscriptionState(new Date("2026-11-01T00:00:01Z"), now)).toEqual({ kind: "active", daysLeft: 1 });
    expect(subscriptionState(new Date("2026-11-11T00:00:00Z"), now)).toEqual({ kind: "active", daysLeft: 10 });
    expect(subscriptionState(now, now)).toEqual({ kind: "expired" });
  });
});

describe("referral codes", () => {
  it("are 8 characters of the unambiguous alphabet", () => {
    const c = referralCodeFrom(new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]));
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect([...c].every((ch) => REFERRAL_ALPHABET.includes(ch))).toBe(true);
    expect(REFERRAL_ALPHABET).not.toMatch(/[IO01]/);
  });
  it("accept what people type: lower case, spaces, dashes, Persian digits; refuse the rest", () => {
    expect(normalizeReferralCode(" ab-cd ef23 ")).toBe("ABCDEF23");
    expect(normalizeReferralCode("ABCDEFG۲")).toBe("ABCDEFG2");
    expect(normalizeReferralCode("ABCDEFGO")).toBeNull(); // O is not in the alphabet
    expect(normalizeReferralCode("SHORT")).toBeNull();
    expect(normalizeReferralCode("ABCDEFGHJ")).toBeNull();
  });
});

describe("inputs", () => {
  it("plans: whole Toman, a real duration, Persian messages", () => {
    expect(planInputSchema.parse({ name: " ماهانه ", priceToman: 100_000, durationDays: 30 })).toEqual({ name: "ماهانه", description: "", priceToman: 100_000, durationDays: 30, maxProducts: 500, maxStaff: 20, active: true });
    expect(planInputSchema.safeParse({ name: "x", priceToman: 1, durationDays: 30 }).success).toBe(false);
    expect(planInputSchema.safeParse({ name: "پلن", priceToman: -1, durationDays: 30 }).success).toBe(false);
    expect(planInputSchema.safeParse({ name: "پلن", priceToman: 1.5, durationDays: 30 }).success).toBe(false);
    expect(planInputSchema.safeParse({ name: "پلن", priceToman: MAX_PRICE_TOMAN + 1, durationDays: 30 }).success).toBe(false);
    expect(planInputSchema.safeParse({ name: "پلن", priceToman: 1, durationDays: 0 }).success).toBe(false);
    expect(planInputSchema.safeParse({ name: "پلن", priceToman: 1, durationDays: 30, extra: 1 }).success).toBe(false);
  });
  it("wallet adjustments: signed, non-zero, with a reason", () => {
    expect(walletAdjustSchema.safeParse({ amountToman: -5000, reason: "اصلاح" }).success).toBe(true);
    expect(walletAdjustSchema.safeParse({ amountToman: 0, reason: "اصلاح" }).success).toBe(false);
    expect(walletAdjustSchema.safeParse({ amountToman: 10, reason: "" }).success).toBe(false);
    expect(walletAdjustSchema.safeParse({ amountToman: 2_000_000_000, reason: "اصلاح" }).success).toBe(false);
  });
});

describe("plan limits", () => {
  const plan = { maxProducts: 100, maxStaff: 3 };
  it("a running subscription brings its plan's limits; none or an ended one the free limits", () => {
    expect(effectiveLimits(plan, { kind: "active", daysLeft: 5 })).toEqual(plan);
    expect(effectiveLimits(plan, { kind: "expired" })).toEqual(FREE_LIMITS);
    expect(effectiveLimits(null, { kind: "none" })).toEqual(FREE_LIMITS);
    expect(effectiveLimits(plan, { kind: "none" })).toEqual(FREE_LIMITS);
  });
  it("the plan form takes whole numbers inside the platform's maxima and defaults to them", () => {
    const base = { name: "ماهانه", priceToman: 1000, durationDays: 30 };
    expect(planInputSchema.parse(base)).toMatchObject({ maxProducts: 500, maxStaff: 20 });
    expect(planInputSchema.parse({ ...base, maxProducts: 1, maxStaff: 0 })).toMatchObject({ maxProducts: 1, maxStaff: 0 });
    for (const bad of [{ maxProducts: 0 }, { maxProducts: 501 }, { maxProducts: 2.5 }, { maxStaff: -1 }, { maxStaff: 21 }]) expect(planInputSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });
  it("the owner's sentence names the limit and whether a plan would raise it", () => {
    expect(planLimitMessage({ kind: "product", limit: 30, free: true })).toContain("بدون اشتراک فعال");
    expect(planLimitMessage({ kind: "staff", limit: 3, free: false })).toContain("پلن شما");
  });
});
