import type { PriceLink, RateCode } from "@store-builder/shared/modules/pricing/pricing";
import type { RatesSettings } from "@store-builder/shared/modules/platform/settings";
import type { CurrentRates } from "../domain/pricing.js";

export interface RateRow {
  id: string;
  code: RateCode;
  rateToman: number;
  source: string;
  observedAt: Date;
  status: "APPLIED" | "PENDING" | "REJECTED";
  decidedById: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/** Rate history (append-only rows; the current rate of a code = its latest APPLIED row). */
export interface RateStore {
  current(): Promise<CurrentRates>;
  /** The rate that was current 24 hours before `now` (the latest APPLIED row decided at or before then), or null. */
  dayReference(code: RateCode, now: Date): Promise<number | null>;
  /** The latest APPLIED rate a person entered or confirmed (decidedById set), or null. */
  humanReference(code: RateCode): Promise<number | null>;
  pending(): Promise<RateRow[]>;
  history(limit: number): Promise<RateRow[]>;
  /**
   * Records a rate. APPLIED and PENDING supersede the code's older PENDING rows (they become REJECTED: a newer reading replaced them).
   * `audit` is written in the same transaction when a person did it.
   */
  record(r: { code: RateCode; rateToman: number; source: string; observedAt: Date; status: RateRow["status"]; decidedById: string | null; now: Date }, audit: { actorId: string; action: string } | null): Promise<RateRow>;
  /** PENDING -> APPLIED or REJECTED by a super admin (audited). "missing" for an unknown id, "not_pending" when it was decided already. */
  decide(id: string, to: "APPLIED" | "REJECTED", actorId: string, now: Date): Promise<"ok" | "missing" | "not_pending">;
}

export interface LinkView {
  productId: string;
  variantId: string | null;
  kind: "USD" | "GOLD";
  usdCents: number | null;
  weightMg: number | null;
  wageBp: number;
  profitBp: number;
  taxBp: number;
  stoneToman: number;
  roundingToman: number;
  status: "OK" | "OUT_OF_RANGE";
  lastPriceToman: number | null;
  lastRateAt: Date | null;
}

/** Merchant link writes inside one store mutation (store row locked and owned). */
export interface LinkWrites {
  /** Row lock on the product. null = not in this store; otherwise whether it has variants and the ids of those variants. */
  lockProduct(productId: string): Promise<{ variantIds: string[] } | null>;
  upsert(productId: string, variantId: string | null, link: PriceLink, priceToman: number, rateAt: Date): Promise<LinkView>;
  remove(productId: string, variantId: string | null): Promise<boolean>;
  /** Writes the computed price on the product (no variants) or the variant, then the product's lowest-variant price and the live rows. */
  applyPrice(productId: string, variantId: string | null, priceToman: number, now: Date): Promise<void>;
  /** After an unlink: the live row of that target goes, and the product summary row is refreshed (or removed when nothing is linked). */
  dropLive(productId: string, variantId: string | null, now: Date): Promise<void>;
}

export interface LinkUnitOfWork {
  run<T>(ownerId: string, storeId: string, work: (w: LinkWrites) => Promise<T>): Promise<T>;
}

export interface LinkReader {
  /** null = the product is not in this store. */
  list(storeId: string, productId: string): Promise<LinkView[] | null>;
}

/**
 * Applies the CURRENT rates (read inside each store's transaction, so a rate decided mid-run is never overwritten by an older one) to every
 * link of every store. A store that fails is logged and counted, never stops the others.
 */
export interface Repricer {
  repriceAll(now: Date): Promise<RepriceReport>;
}
export interface RepriceReport {
  stores: number;
  priced: number;
  outOfRange: number;
  failedStores: number;
}

/** Fresh readings from a provider. A code the provider did not answer is absent. */
export type RateReadings = Partial<Record<RateCode, { rateToman: number; observedAt: Date }>>;

export interface RateSource {
  readonly name: string;
  fetch(): Promise<RateReadings>;
}

export interface RatesConfig {
  settings(): Promise<RatesSettings>;
  /** The provider for the current settings, or null (off / manual / no key). Never logs or returns the key. */
  source(settings: RatesSettings): Promise<RateSource | null>;
}
