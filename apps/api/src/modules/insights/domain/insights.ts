import { parseAnalyticsRange, DEFAULT_ANALYTICS_RANGE, type AnalyticsRange } from "@store-builder/shared/modules/analytics/analytics";

/** The dashboard range from the query: absent = 30 days; anything but 7, 30 or 90 is refused by the caller. */
export function dashboardRange(raw: unknown): AnalyticsRange | null {
  return raw === undefined || raw === "" ? DEFAULT_ANALYTICS_RANGE : parseAnalyticsRange(raw);
}

/** `LIKE` wildcards in what an operator typed are plain characters. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A subscription is "expiring soon" when it ends within this many days. */
export const EXPIRING_SOON_DAYS = 7;
