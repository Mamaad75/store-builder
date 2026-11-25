import {
  LOW_STOCK_LIST_LIMIT,
  LOW_STOCK_THRESHOLD,
  OVERVIEW_PERIODS,
  periodStarts,
  summarizePending,
  summarizePeriod,
  type Amount,
  type OrderBucket,
  type OverviewPeriod,
  type PendingSummary,
  type PeriodSummary,
} from "@store-builder/shared/modules/orders/overview";

/** What the overview reads, always scoped to ONE store (the caller's, from the access guard). */
export interface OverviewReader {
  /** Orders created at or after `since` (null: any date), grouped by status and payment method. */
  buckets(storeId: string, since: Date | null): Promise<OrderBucket[]>;
  /** AWAITING_PAYMENT card-to-card orders that have a receipt waiting for review. */
  cardInReview(storeId: string): Promise<Amount>;
  /** ACTIVE products whose stock (or one variant's) is at or below the threshold: how many, and the lowest first. */
  lowStock(storeId: string, threshold: number, limit: number): Promise<{ total: number; items: { productId: string; name: string; stock: number }[] }>;
}

export interface StoreOverview {
  generatedAt: string;
  periods: Record<OverviewPeriod, PeriodSummary>;
  pending: PendingSummary;
  actions: { receiptsToReview: number; toConfirm: number; toShip: number };
  lowStock: { threshold: number; total: number; items: { productId: string; name: string; stock: number }[] };
}

/** M2 (MVP roadmap §12.4): the store overview. The money rules live in shared/modules/orders/overview.ts; this only aggregates. */
export class OverviewService {
  constructor(
    private readonly reader: OverviewReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async overview(a: { storeId: string }): Promise<StoreOverview> {
    const now = this.clock();
    const starts = periodStarts(now);
    const [periodBuckets, all, inReview, lowStock] = await Promise.all([
      Promise.all(OVERVIEW_PERIODS.map((p) => this.reader.buckets(a.storeId, starts[p]))),
      this.reader.buckets(a.storeId, null),
      this.reader.cardInReview(a.storeId),
      this.reader.lowStock(a.storeId, LOW_STOCK_THRESHOLD, LOW_STOCK_LIST_LIMIT),
    ]);
    const periods = Object.fromEntries(OVERVIEW_PERIODS.map((p, i) => [p, summarizePeriod(periodBuckets[i]!)])) as Record<OverviewPeriod, PeriodSummary>;
    const count = (s: string) => all.filter((b) => b.status === s).reduce((n, b) => n + b.count, 0);
    return {
      generatedAt: now.toISOString(),
      periods,
      pending: summarizePending(all, inReview),
      actions: { receiptsToReview: inReview.count, toConfirm: count("PLACED"), toShip: count("CONFIRMED") },
      lowStock: { threshold: LOW_STOCK_THRESHOLD, ...lowStock },
    };
  }
}
