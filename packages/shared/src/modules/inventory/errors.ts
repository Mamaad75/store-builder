/** Stock errors (phase 3.2). */
export interface ShortItem {
  productId: string;
  variantId: string | null;
  /** What is left now (never more than asked for is promised). */
  available: number;
}

/** A reservation could not be made: nothing was held (all or nothing). */
export class OutOfStockError extends Error {
  constructor(public readonly items: ShortItem[]) {
    super("موجودی کافی نیست.");
    this.name = "OutOfStockError";
  }
}

/**
 * A checkout tried to turn its hold into an order, but the hold is no longer complete (expired, released, or dropped because the merchant
 * changed the product's variants). Nothing was consumed: the checkout must reserve again.
 */
export class ReservationLostError extends Error {
  constructor() {
    super("زمان نگه‌داری موجودی سبد تمام شده یا کالاها تغییر کرده‌اند؛ دوباره تلاش کنید.");
    this.name = "ReservationLostError";
  }
}

/** The store's variant cap (MAX_VARIANTS_PER_STORE) would be exceeded. */
export class VariantLimitError extends Error {
  constructor(public readonly limit: number) {
    super("تعداد تنوع‌های فروشگاه به سقف رسیده است.");
    this.name = "VariantLimitError";
  }
}
