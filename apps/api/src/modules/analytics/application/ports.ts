import type { DayStats } from "@store-builder/shared/modules/analytics/analytics";

export interface VisitStore {
  /** One page view for a live store on a Tehran day; counts the visitor once per day (`hash`). Atomic; never throws for a repeat. */
  record(storeId: string, day: string, hash: string): Promise<void>;
}

export interface AnalyticsReader {
  /** Days (key `YYYY-MM-DD`) in [from, to] that have any data: views and visitors, valid orders and their value, new customers. */
  dailyRows(storeId: string, from: string, to: string, range: { fromInstant: Date; toInstant: Date }): Promise<Map<string, Partial<DayStats>>>;
  /** The first day a page view was recorded for the store, or null. */
  trackingSince(storeId: string): Promise<string | null>;
}

export interface Limiter {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}
