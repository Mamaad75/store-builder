import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { InsightsService } from "./insights.service.js";
import type { InsightsRepository } from "./ports.js";

const NOW = new Date("2026-11-27T10:00:00Z");
const FIGURES = { users: 1, stores: 1, publishedStores: 0, suspendedStores: 0, openTickets: 0, answeredTickets: 0, activeSubscriptions: 0, expiringSoon: 0, walletOutstandingToman: 0 };
function repo(over: Partial<InsightsRepository> = {}): InsightsRepository & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    dailyRows: async (...a) => (calls.push(["daily", ...a]), new Map()),
    figures: async (...a) => (calls.push(["figures", ...a]), FIGURES),
    accounts: async (f) => (calls.push(["accounts", f]), []),
    account: async () => null, store: async () => null,
    activity: async (f) => (calls.push(["activity", f]), []),
    ...over,
  };
}

describe("InsightsService", () => {
  it("asks for two periods of Tehran days, ending at the end of today, and shapes them", async () => {
    const r = repo();
    const d = await new InsightsService(r, () => NOW).dashboard("7");
    expect(d.days).toBe(7);
    expect(d.series).toHaveLength(7);
    const [, from, to] = r.calls[0] as [string, Date, Date];
    // 14 Tehran days: from the start of 2026-11-14 (20:30 UTC the day before) to the end of 2026-11-27 (20:30 UTC)
    expect(from.toISOString()).toBe("2026-11-13T20:30:00.000Z");
    expect(to.toISOString()).toBe("2026-11-27T20:30:00.000Z");
    expect(d.figures).toEqual(FIGURES);
    expect(((r.calls[1] as unknown[])[2] as Date).toISOString()).toBe("2026-12-04T10:00:00.000Z"); // "expiring soon" = within 7 days
  });
  it("refuses a range other than 7, 30 or 90, defaulting to 30", async () => {
    await expect(new InsightsService(repo()).dashboard("14")).rejects.toBeInstanceOf(ValidationError);
    expect((await new InsightsService(repo(), () => NOW).dashboard(undefined)).days).toBe(30);
  });
  it("trims the search, bounds the page, and expands an activity group into its actions", async () => {
    const r = repo();
    const svc = new InsightsService(r, () => NOW);
    await svc.accounts({ q: "  ali  ", limit: "20" });
    expect(r.calls[0]).toEqual(["accounts", { q: "ali", before: undefined, limit: 20 }]);
    await expect(svc.accounts({ limit: "1000" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.accounts({ before: "nope" })).rejects.toBeInstanceOf(ValidationError);
    await svc.activity({ group: "money" });
    const f = (r.calls[1] as [string, { actions: string[] }])[1];
    expect(f.actions).toContain("platform.purchase_recorded");
    expect(f.actions).not.toContain("platform.ticket_replied");
    await expect(svc.activity({ group: "bogus" })).rejects.toBeInstanceOf(ValidationError);
  });
  it("answers a missing or malformed account or store as not found", async () => {
    const svc = new InsightsService(repo());
    await expect(svc.account("abc")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.store("abc")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.store("../x")).rejects.toBeInstanceOf(NotFoundError);
  });
});
