import { describe, expect, it } from "vitest";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { AnalyticsService } from "./analytics.service.js";
import type { AnalyticsReader } from "./ports.js";

function setup(rows: Awaited<ReturnType<AnalyticsReader["dailyRows"]>> = new Map(), since: string | null = null) {
  const calls: { from: string; to: string; fromInstant: string; toInstant: string }[] = [];
  const reader: AnalyticsReader = {
    dailyRows: async (_s, from, to, r) => (calls.push({ from, to, fromInstant: r.fromInstant.toISOString(), toInstant: r.toInstant.toISOString() }), rows),
    trackingSince: async () => since,
  };
  return { svc: new AnalyticsService(reader, () => new Date("2026-11-26T10:00:00Z")), calls };
}

describe("AnalyticsService.report", () => {
  it("asks for the period and the one before it, in Tehran days, with exact instants (end exclusive)", async () => {
    const { svc, calls } = setup();
    await svc.report({ storeId: "st" }, "7");
    expect(calls).toEqual([{ from: "2026-11-13", to: "2026-11-26", fromInstant: "2026-11-12T20:30:00.000Z", toInstant: "2026-11-26T20:30:00.000Z" }]);
  });
  it("defaults to 30 days and builds the series, totals and comparison from what the reader returns", async () => {
    const { svc } = setup(new Map([["2026-11-26", { views: 4, visitors: 2, orders: 1, sales: 900, customers: 1 }], ["2026-10-20", { views: 1, visitors: 1 }]]), "2026-10-20");
    const r = await svc.report({ storeId: "st" }, undefined);
    expect([r.days, r.series.length, r.totals.current.sales, r.totals.previous.views, r.trackingSince, r.conversionPercent]).toEqual([30, 30, 900, 1, "2026-10-20", 50]);
  });
  it("refuses any other range", async () => {
    const { svc } = setup();
    for (const bad of ["8", "0", "abc", "-1", "30.5", "9999"]) await expect(svc.report({ storeId: "st" }, bad)).rejects.toBeInstanceOf(ValidationError);
  });
});
