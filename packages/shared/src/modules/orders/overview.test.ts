import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, PAYMENT_METHODS } from "./orders.js";
import { countsAsOrderValue, countsAsPaidRevenue, pendingKind, periodStarts, summarizePending, summarizePeriod, type OrderBucket } from "./overview.js";

describe("M2 overview rules (roadmap §12.4)", () => {
  it("order value: PLACED…DELIVERED for every method; never AWAITING_PAYMENT, CANCELLED, EXPIRED", () => {
    expect(ORDER_STATUSES.filter(countsAsOrderValue)).toEqual(["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED"]);
  });

  it("paid revenue: COD only when DELIVERED; ONLINE and CARD_TRANSFER from PLACED", () => {
    const paid = (m: (typeof PAYMENT_METHODS)[number]) => ORDER_STATUSES.filter((s) => countsAsPaidRevenue(s, m));
    expect(paid("COD")).toEqual(["DELIVERED"]);
    expect(paid("ONLINE")).toEqual(["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED"]);
    expect(paid("CARD_TRANSFER")).toEqual(["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED"]);
  });

  it("pending: COD to collect until delivered; online and card-to-card while awaiting payment; nothing for cancelled/expired", () => {
    const kinds = (m: (typeof PAYMENT_METHODS)[number]) => Object.fromEntries(ORDER_STATUSES.map((s) => [s, pendingKind(s, m)]));
    expect(kinds("COD")).toEqual({ AWAITING_PAYMENT: null, PLACED: "COD_TO_COLLECT", CONFIRMED: "COD_TO_COLLECT", SHIPPED: "COD_TO_COLLECT", DELIVERED: null, CANCELLED: null, EXPIRED: null });
    expect(kinds("ONLINE")).toEqual({ AWAITING_PAYMENT: "ONLINE_AWAITING", PLACED: null, CONFIRMED: null, SHIPPED: null, DELIVERED: null, CANCELLED: null, EXPIRED: null });
    expect(kinds("CARD_TRANSFER").AWAITING_PAYMENT).toBe("CARD_AWAITING");
    expect(Object.values(kinds("CARD_TRANSFER")).filter(Boolean)).toHaveLength(1);
  });

  it("summaries add counts and totals per rule; the card split subtracts the orders in review", () => {
    const b: OrderBucket[] = [
      { status: "DELIVERED", paymentMethod: "COD", count: 1, total: 100 },
      { status: "SHIPPED", paymentMethod: "COD", count: 2, total: 200 },
      { status: "PLACED", paymentMethod: "ONLINE", count: 1, total: 50 },
      { status: "AWAITING_PAYMENT", paymentMethod: "ONLINE", count: 3, total: 30 },
      { status: "AWAITING_PAYMENT", paymentMethod: "CARD_TRANSFER", count: 2, total: 40 },
      { status: "CANCELLED", paymentMethod: "CARD_TRANSFER", count: 5, total: 999 },
      { status: "EXPIRED", paymentMethod: "ONLINE", count: 5, total: 999 },
    ];
    expect(summarizePeriod(b)).toEqual({ orders: { count: 4, total: 350 }, paid: { count: 2, total: 150 } });
    expect(summarizePending(b, { count: 1, total: 15 })).toEqual({
      codToCollect: { count: 2, total: 200 },
      onlineAwaiting: { count: 3, total: 30 },
      cardReceiptInReview: { count: 1, total: 15 },
      cardAwaitingCustomer: { count: 1, total: 25 },
    });
  });

  it("periods start at Tehran midnight (UTC+03:30): today, 6 and 29 days before", () => {
    // 2026-11-24 22:00 UTC is 2026-11-25 01:30 in Tehran: "today" began at 2026-11-24 20:30 UTC.
    const p = periodStarts(new Date("2026-11-24T22:00:00Z"));
    expect(p.today.toISOString()).toBe("2026-11-24T20:30:00.000Z");
    expect(p.days7.toISOString()).toBe("2026-11-18T20:30:00.000Z");
    expect(p.days30.toISOString()).toBe("2026-10-26T20:30:00.000Z");
    // 2026-11-24 20:00 UTC is 23:30 in Tehran on the 24th: "today" began at 2026-11-23 20:30 UTC.
    expect(periodStarts(new Date("2026-11-24T20:00:00Z")).today.toISOString()).toBe("2026-11-23T20:30:00.000Z");
  });

  it("periods agree with the IANA Asia/Tehran zone for every hour of 2024-2027 (fails if Iran's clock rules change)", () => {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const local = (d: Date) => fmt.format(d).replace(", ", " ");
    const day = (d: Date) => local(d).slice(0, 10);
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2028, 0, 1); t += 3_600_000) {
      const now = new Date(t);
      const p = periodStarts(now);
      expect(local(p.today)).toBe(`${day(now)} 00:00:00`); // starts at Tehran midnight of the current Tehran day
      expect(day(new Date(p.today.getTime() - 1))).not.toBe(day(now)); // the millisecond before belongs to the previous day
      expect(Math.round((p.today.getTime() - p.days7.getTime()) / 86_400_000)).toBe(6);
      expect(Math.round((p.today.getTime() - p.days30.getTime()) / 86_400_000)).toBe(29);
    }
  });
});

