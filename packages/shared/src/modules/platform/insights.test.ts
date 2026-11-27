import { describe, expect, it } from "vitest";
import { buildDashboardSeries, PLATFORM_AUDIT_ACTIONS, platformAuditDetails, platformAuditGroup, platformAuditLabel } from "./insights.js";

describe("dashboard series", () => {
  const now = new Date("2026-11-27T10:00:00Z"); // Tehran day 2026-11-27
  it("covers the last N Tehran days and compares them with the N before", () => {
    const rows = new Map([
      ["2026-11-27", { newStores: 2, revenue: 450_000, purchases: 1 }],
      ["2026-11-21", { newStores: 1 }],
      ["2026-11-20", { newStores: 5, revenue: 100_000, purchases: 1 }], // previous period (7 days back from 21st)
    ]);
    const d = buildDashboardSeries(now, 7, rows);
    expect(d.series).toHaveLength(7);
    expect([d.from, d.to]).toEqual(["2026-11-21", "2026-11-27"]);
    expect(d.series.at(-1)).toMatchObject({ day: "2026-11-27", newStores: 2, revenue: 450_000, newUsers: 0 });
    expect(d.totals.current).toMatchObject({ newStores: 3, revenue: 450_000, purchases: 1 });
    expect(d.totals.previous).toMatchObject({ newStores: 5, revenue: 100_000 });
  });
  it("a day with no data is all zeros, and old data outside both periods is ignored", () => {
    const d = buildDashboardSeries(now, 7, new Map([["2026-01-01", { newUsers: 99 }]]));
    expect(d.totals.current.newUsers).toBe(0);
    expect(d.totals.previous.newUsers).toBe(0);
    expect(d.series.every((s) => s.newStores === 0 && s.revenue === 0)).toBe(true);
  });
});

describe("platform activity labels", () => {
  it("labels and groups known actions; an unknown action shows as its code", () => {
    expect(platformAuditLabel("platform.plan_created")).toMatch(/پلن/);
    expect(platformAuditGroup("platform.purchase_recorded")).toBe("money");
    expect(platformAuditLabel("platform.unheard_of")).toBe("platform.unheard_of");
    expect(platformAuditGroup("platform.unheard_of")).toBeNull();
    for (const a of Object.values(PLATFORM_AUDIT_ACTIONS)) expect(a.label).toMatch(/[؀-ۿ]/);
  });
  it("shows only listed facts: money with the unit, booleans in words, ticket statuses in Persian; free text and unknown keys never", () => {
    expect(platformAuditDetails({ priceToman: 450000, active: true, status: "ANSWERED", reason: "دلیل محرمانه", note: "x", storeId: "abc", rewardedStoreId: "zzz" })).toEqual(["قیمت: ۴۵۰٬۰۰۰ تومان", "فعال: بله", "وضعیت: پاسخ داده شد"]);
    expect(platformAuditDetails({ name: "x".repeat(41) })).toEqual([]); // too long: dropped
    expect(platformAuditDetails(null)).toEqual([]);
    expect(platformAuditDetails([1, 2])).toEqual([]);
    expect(platformAuditDetails({ amountToman: -5000, balanceAfter: 0 })).toEqual(["مبلغ: ‎−۵٬۰۰۰ تومان", "موجودی پس از آن: ۰ تومان"]);
  });
});
