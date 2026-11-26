import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { buildAnalytics, dayKeys, DEFAULT_ANALYTICS_RANGE, parseAnalyticsRange, type AnalyticsResult } from "@store-builder/shared/modules/analytics/analytics";
import { TEHRAN_OFFSET_MINUTES } from "@store-builder/shared/modules/orders/overview";
import type { AnalyticsReader } from "./ports.js";

/** The store trend charts: one read-only report for ONE store (the caller's, from the access guard). Rules live in shared/analytics. */
export class AnalyticsService {
  constructor(
    private readonly reader: AnalyticsReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async report(a: { storeId: string }, days: unknown): Promise<AnalyticsResult> {
    const range = days === undefined || days === "" ? DEFAULT_ANALYTICS_RANGE : parseAnalyticsRange(days);
    if (!range) throw new ValidationError({ days: ["بازه‌ی نمودار باید ۷، ۳۰ یا ۹۰ روز باشد"] });
    const now = this.clock();
    const keys = dayKeys(now, range * 2); // the period and the one before it, for the comparison
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    const offset = TEHRAN_OFFSET_MINUTES * 60_000;
    const fromInstant = new Date(Date.parse(`${first}T00:00:00Z`) - offset);
    const toInstant = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000 - offset); // exclusive: the end of the last Tehran day
    const [rows, since] = await Promise.all([this.reader.dailyRows(a.storeId, first, last, { fromInstant, toInstant }), this.reader.trackingSince(a.storeId)]);
    return buildAnalytics(now, range, rows, since);
  }
}
