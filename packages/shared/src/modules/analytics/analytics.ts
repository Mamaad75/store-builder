import { TEHRAN_OFFSET_MINUTES } from "../orders/overview.js";

/**
 * The store trend charts (dashboard home): per Tehran calendar day, page views, visitors, orders, sales and new customers. Pure: the API
 * gathers one row per day, this lines them up (a day without data is zeros), splits the current period from the one before it and derives
 * the change figures. The same structure is what a later daily-suggestion job can read, so it carries no display text.
 *
 * Definitions (shown to the merchant next to the charts):
 *  - views: pages a shopper opened on the live store. Bots and shoppers who send "Do Not Track" are not counted.
 *  - visitors: distinct shoppers per day, summed over the days (a shopper who returns on two days counts twice). Distinctness comes from a
 *    daily hash that cannot be reversed or linked across days, so no shopper can be followed.
 *  - orders / sales: order value rules of roadmap §12.4 (PLACED to DELIVERED, every payment method; gross, in toman).
 *  - customers: shopper accounts created that day.
 */
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = 30;

export interface DayStats {
  views: number;
  visitors: number;
  orders: number;
  sales: number;
  customers: number;
}
export const EMPTY_DAY: Readonly<DayStats> = { views: 0, visitors: 0, orders: 0, sales: 0, customers: 0 };
export const STAT_KEYS = ["views", "visitors", "orders", "sales", "customers"] as const satisfies readonly (keyof DayStats)[];

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` of the Tehran calendar day an instant falls in. */
export function tehranDayKey(at: Date): string {
  return new Date(at.getTime() + TEHRAN_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** The `days` Tehran day keys ending today, oldest first. */
export function dayKeys(now: Date, days: number): string[] {
  const todayUtc = Date.parse(`${tehranDayKey(now)}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(todayUtc - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

export function parseAnalyticsRange(v: unknown): AnalyticsRange | null {
  const n = typeof v === "string" && /^\d{1,3}$/.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  return (ANALYTICS_RANGES as readonly number[]).includes(n) ? (n as AnalyticsRange) : null;
}

export interface AnalyticsResult {
  days: AnalyticsRange;
  from: string;
  to: string;
  /** The first day page views were recorded for this store (null = none yet): visit figures are zero before it, not "unknown". */
  trackingSince: string | null;
  series: ({ day: string } & DayStats)[];
  totals: { current: DayStats; previous: DayStats };
  /** Orders per hundred visitors in the period (one decimal); null without visitors. */
  conversionPercent: number | null;
}

const sum = (rows: readonly DayStats[]): DayStats => {
  const t = { ...EMPTY_DAY };
  for (const r of rows) for (const k of STAT_KEYS) t[k] += r[k];
  return t;
};

/**
 * `rows` holds whatever days have data (any day outside the two periods is ignored). The previous period is the same number of days
 * right before the current one, so every figure has a fair comparison.
 */
export function buildAnalytics(now: Date, days: AnalyticsRange, rows: ReadonlyMap<string, Partial<DayStats>>, trackingSince: string | null): AnalyticsResult {
  const all = dayKeys(now, days * 2);
  const stats = all.map((day) => ({ day, ...EMPTY_DAY, ...(rows.get(day) ?? {}) }));
  const series = stats.slice(days);
  const totals = { current: sum(series), previous: sum(stats.slice(0, days)) };
  const conversionPercent = totals.current.visitors > 0 ? Math.round((totals.current.orders / totals.current.visitors) * 1000) / 10 : null;
  return { days, from: series[0]!.day, to: series[series.length - 1]!.day, trackingSince, series, totals, conversionPercent };
}

/** Change against the previous period in percent (whole number); null when there was nothing before (a ratio would mean nothing). */
export function changePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export const isDayKey = (v: string): boolean => DAY_RE.test(v);
