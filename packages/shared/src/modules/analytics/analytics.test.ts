import { describe, expect, it } from "vitest";
import { buildAnalytics, changePercent, dayKeys, parseAnalyticsRange, tehranDayKey } from "./analytics";

describe("tehranDayKey / dayKeys", () => {
  it("uses the Tehran calendar day (UTC+03:30), not the UTC day", () => {
    expect(tehranDayKey(new Date("2026-11-25T20:29:59Z"))).toBe("2026-11-25"); // 23:59:59 in Tehran
    expect(tehranDayKey(new Date("2026-11-25T20:30:00Z"))).toBe("2026-11-26"); // midnight in Tehran
  });
  it("lists the days ending today, oldest first", () => {
    expect(dayKeys(new Date("2026-11-26T10:00:00Z"), 3)).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
    expect(dayKeys(new Date("2026-03-02T10:00:00Z"), 4)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]); // month boundary
  });
});

describe("parseAnalyticsRange", () => {
  it("accepts only the offered ranges", () => {
    expect([parseAnalyticsRange("7"), parseAnalyticsRange("30"), parseAnalyticsRange("90"), parseAnalyticsRange(30)]).toEqual([7, 30, 90, 30]);
    for (const bad of ["8", "0", "-7", "7.5", "abc", "", undefined, null, "1000"]) expect(parseAnalyticsRange(bad)).toBeNull();
  });
});

describe("buildAnalytics", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  const rows = new Map<string, { views?: number; visitors?: number; orders?: number; sales?: number; customers?: number }>([
    ["2026-11-26", { views: 10, visitors: 4, orders: 1, sales: 500, customers: 1 }],
    ["2026-11-25", { views: 6, visitors: 2, orders: 1, sales: 300 }],
    ["2026-11-23", { views: 3, visitors: 3, orders: 0 }], // before the 2-day current window: previous period
    ["2026-11-24", { views: 2, visitors: 1, sales: 100, orders: 1 }],
    ["2026-01-01", { views: 999 }], // far outside both periods: ignored
  ]);

  it("fills missing days with zeros and splits current from previous", () => {
    const a = buildAnalytics(now, 7, rows, "2026-11-23");
    expect(a.series).toHaveLength(7);
    expect(a.series.map((d) => d.day)[0]).toBe("2026-11-20");
    expect(a.series.at(-1)).toEqual({ day: "2026-11-26", views: 10, visitors: 4, orders: 1, sales: 500, customers: 1 });
    expect(a.series.find((d) => d.day === "2026-11-22")).toEqual({ day: "2026-11-22", views: 0, visitors: 0, orders: 0, sales: 0, customers: 0 });
    expect(a.totals.current).toEqual({ views: 21, visitors: 10, orders: 3, sales: 900, customers: 1 });
    expect(a.totals.previous).toEqual({ views: 0, visitors: 0, orders: 0, sales: 0, customers: 0 });
    expect([a.from, a.to, a.trackingSince]).toEqual(["2026-11-20", "2026-11-26", "2026-11-23"]);
  });

  it("the previous period is the same length right before; conversion is orders per hundred visitors", () => {
    const a = buildAnalytics(now, 7, new Map([...rows, ["2026-11-15", { views: 5, visitors: 5, orders: 2, sales: 40, customers: 2 }]]), null);
    expect(a.totals.previous).toEqual({ views: 5, visitors: 5, orders: 2, sales: 40, customers: 2 });
    expect(a.conversionPercent).toBe(30); // 3 orders / 10 visitors
    expect(buildAnalytics(now, 7, new Map(), null).conversionPercent).toBeNull(); // no visitors: no ratio
  });
});

describe("changePercent", () => {
  it("is a whole percent, and null when there is no earlier figure to compare with", () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(100, 100)).toBe(0);
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(0, 0)).toBeNull();
  });
});
