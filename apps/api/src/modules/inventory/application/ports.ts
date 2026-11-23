import type { VariantOption } from "@store-builder/shared/modules/inventory/variants";
import type { ReservationLine, StockFacts } from "../domain/inventory.js";

export interface VariantView {
  id: string;
  options: VariantOption[];
  optionsKey: string;
  sku: string | null;
  price: number;
  stockQuantity: number;
  position: number;
}

export interface VariantData {
  options: VariantOption[];
  optionsKey: string;
  sku: string | null;
  price: number;
  stockQuantity: number;
  position: number;
}

/** Reads outside a mutation; bound to the store in SQL. null = the product is not in this store. */
export interface VariantReader {
  list(storeId: string, productId: string): Promise<VariantView[] | null>;
}

/** Variant writes inside one store mutation (store row locked and owned; lock order Store -> Product -> variants). */
export interface VariantWrites {
  /** Row lock on the product; false = not in this store. */
  lockProduct(productId: string): Promise<boolean>;
  list(productId: string): Promise<VariantView[]>;
  countInStore(): Promise<number>;
  update(id: string, data: VariantData): Promise<void>;
  insert(productId: string, data: VariantData): Promise<void>;
  /**
   * Marks ACTIVE reservations RELEASED without giving stock back (the rows they point at are deleted or overwritten): those of the given
   * variants, and with `productLevel` also the product-level ones (a product that starts having variants is sold only by variant).
   */
  dropReservations(productId: string, variantIds: string[], productLevel: boolean): Promise<number>;
  delete(variantIds: string[]): Promise<void>;
  /** The product shows the lowest variant price and the summed stock (D32-1). */
  setProductSummary(productId: string, summary: { price: number; stockQuantity: number }): Promise<void>;
}

export interface VariantUnitOfWork {
  run<T>(ownerId: string, storeId: string, work: (writes: VariantWrites) => Promise<T>): Promise<T>;
}

/**
 * Stock operations for checkout, each one transaction. `reserve` locks the product rows and then the variant rows in lock order,
 * reads the facts and calls `decide`; only when `decide` returns no shortages are the quantities taken out (conditional updates) and
 * the reservations written. Otherwise nothing is written.
 */
export interface StockLedger {
  reserve(
    storeId: string,
    ref: string,
    lines: ReservationLine[],
    expiresAt: Date,
    decide: (facts: StockFacts[]) => { line: ReservationLine; available: number }[],
  ): Promise<{ reserved: true } | { reserved: false; short: { line: ReservationLine; available: number }[] }>;
  /** ACTIVE reservations of `ref` -> RELEASED, quantities given back. Returns how many. */
  release(storeId: string, ref: string): Promise<number>;
  /**
   * All or nothing: when `ref` holds exactly `expectedLines` ACTIVE, unexpired reservations they all become CONSUMED (true); otherwise
   * nothing changes (false) — part of the hold expired, was released, or was dropped by a variant change.
   */
  consume(storeId: string, ref: string, now: Date, expectedLines: number): Promise<boolean>;
  /** Expired ACTIVE reservations (any store) -> RELEASED, quantities given back, at most `limit`. */
  releaseExpired(now: Date, limit: number): Promise<number>;
}
