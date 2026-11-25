import type { OrderStatus, PaymentMethod } from "./orders.js";

/**
 * M2 (MVP roadmap §12.4, approved by the owner 2026-11-25): the store overview's money rules, in ONE place. Pure; the API aggregates with
 * them and the dashboard only displays the result.
 *
 *  | Metric           | COD                                 | ONLINE                         | CARD_TRANSFER                                  |
 *  |------------------|-------------------------------------|--------------------------------|------------------------------------------------|
 *  | Order value      | PLACED, CONFIRMED, SHIPPED, DELIVERED (all methods)                                                    |
 *  | Paid revenue     | DELIVERED only (cash collected)     | PLACED…DELIVERED (verified)    | PLACED…DELIVERED (receipt approved)             |
 *  | Pending payments | PLACED, CONFIRMED, SHIPPED (to collect) | AWAITING_PAYMENT           | AWAITING_PAYMENT: receipt in review / awaiting customer |
 *
 * Why the statuses are enough: an ONLINE order leaves AWAITING_PAYMENT only when the gateway verified the payment, and a CARD_TRANSFER order
 * only when the merchant approved the receipt (phase 3.5, D35b-1). CANCELLED and EXPIRED orders count nowhere; a payment captured for an
 * order that was no longer payable (REFUND_REQUIRED) belongs to a CANCELLED/EXPIRED order, so it is never revenue. Amount = Order.total
 * (toman, after discount, with shipping and cash-on-delivery fee). Periods: by order creation date, Tehran calendar days.
 *
 * GROSS, not net: the data model has no record of a completed refund (REFUND_REQUIRED only marks money that must be returned), so
 * completed refunds are NOT deducted. Never present these figures as net revenue (owner decision 2026-11-25; roadmap §12.4).
 */

export const LOW_STOCK_THRESHOLD = 3;
export const LOW_STOCK_LIST_LIMIT = 10;
/** Iran has used a fixed UTC+03:30 since daylight saving time was abolished in 2022 (1401). */
export const TEHRAN_OFFSET_MINUTES = 210;

export const OVERVIEW_PERIODS = ["today", "days7", "days30"] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];
const PERIOD_DAYS: Record<OverviewPeriod, number> = { today: 1, days7: 7, days30: 30 };

const VALUE_STATUSES: ReadonlySet<OrderStatus> = new Set(["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED"]);

/** Counts in the order value (all methods): a real order that was not cancelled, expired or left unpaid. */
export const countsAsOrderValue = (status: OrderStatus): boolean => VALUE_STATUSES.has(status);

/** Counts as money received by the store. Cash on delivery: only once delivered (assumed collected by the courier). */
export function countsAsPaidRevenue(status: OrderStatus, method: PaymentMethod): boolean {
  if (method === "COD") return status === "DELIVERED";
  return VALUE_STATUSES.has(status); // ONLINE: verified by the gateway; CARD_TRANSFER: receipt approved
}

export type PendingKind = "COD_TO_COLLECT" | "ONLINE_AWAITING" | "CARD_AWAITING";

/** Money still expected (whatever the order date). Card-to-card is split further by whether a receipt waits for review. */
export function pendingKind(status: OrderStatus, method: PaymentMethod): PendingKind | null {
  if (method === "COD") return status === "PLACED" || status === "CONFIRMED" || status === "SHIPPED" ? "COD_TO_COLLECT" : null;
  if (status !== "AWAITING_PAYMENT") return null;
  return method === "ONLINE" ? "ONLINE_AWAITING" : "CARD_AWAITING";
}

/** The start (inclusive) of each period: midnight in Tehran today, 6 days before, 29 days before. */
export function periodStarts(now: Date): Record<OverviewPeriod, Date> {
  const offset = TEHRAN_OFFSET_MINUTES * 60_000;
  const local = new Date(now.getTime() + offset);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const out = {} as Record<OverviewPeriod, Date>;
  for (const p of OVERVIEW_PERIODS) out[p] = new Date(midnightLocal - (PERIOD_DAYS[p] - 1) * 86_400_000 - offset);
  return out;
}

/** Orders grouped by status and payment method (what the database returns). */
export interface OrderBucket {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  count: number;
  total: number;
}

export interface Amount {
  count: number;
  total: number;
}

export interface PeriodSummary {
  /** Order value: number and sum of the orders that count (all methods). */
  orders: Amount;
  /** Paid revenue: number and sum of the orders whose money was received. */
  paid: Amount;
}

const add = (a: Amount, b: { count: number; total: number }): Amount => ({ count: a.count + b.count, total: a.total + b.total });
const ZERO: Amount = { count: 0, total: 0 };

export function summarizePeriod(buckets: readonly OrderBucket[]): PeriodSummary {
  let orders = ZERO;
  let paid = ZERO;
  for (const b of buckets) {
    if (countsAsOrderValue(b.status)) orders = add(orders, b);
    if (countsAsPaidRevenue(b.status, b.paymentMethod)) paid = add(paid, b);
  }
  return { orders, paid };
}

export interface PendingSummary {
  codToCollect: Amount;
  onlineAwaiting: Amount;
  /** Card-to-card orders with a receipt waiting for the merchant's review. */
  cardReceiptInReview: Amount;
  /** Card-to-card orders with no receipt under review (the customer has not sent one, or it was rejected). */
  cardAwaitingCustomer: Amount;
}

/** `cardInReview`: the AWAITING_PAYMENT card-to-card orders that have a SUBMITTED receipt (a subset of the CARD_AWAITING buckets). */
export function summarizePending(buckets: readonly OrderBucket[], cardInReview: Amount): PendingSummary {
  let cod = ZERO;
  let online = ZERO;
  let card = ZERO;
  for (const b of buckets) {
    const k = pendingKind(b.status, b.paymentMethod);
    if (k === "COD_TO_COLLECT") cod = add(cod, b);
    else if (k === "ONLINE_AWAITING") online = add(online, b);
    else if (k === "CARD_AWAITING") card = add(card, b);
  }
  return {
    codToCollect: cod,
    onlineAwaiting: online,
    cardReceiptInReview: cardInReview,
    cardAwaitingCustomer: { count: Math.max(0, card.count - cardInReview.count), total: Math.max(0, card.total - cardInReview.total) },
  };
}
