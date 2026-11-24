import { DISCOUNT_REASON_MESSAGES, type DiscountReason } from "./discounts.js";

/** Phase 5.1: the code cannot be used on this order (reason shown to the shopper). */
export class DiscountInvalidError extends Error {
  constructor(public readonly reason: DiscountReason = "not_found", public readonly minOrder?: number) {
    super(DISCOUNT_REASON_MESSAGES[reason] ?? "این کد تخفیف معتبر نیست.");
    this.name = "DiscountInvalidError";
  }
}

/** Phase 5.1: another discount of this store already has this code. */
export class DiscountCodeTakenError extends Error {
  constructor() {
    super("کد تخفیف دیگری با همین کد در این فروشگاه هست.");
    this.name = "DiscountCodeTakenError";
  }
}

/** Phase 5.1: the store has the maximum number of discount codes. */
export class DiscountLimitError extends Error {
  constructor(public readonly limit: number) {
    super("تعداد کدهای تخفیف این فروشگاه به حداکثر رسیده است؛ کدهای قدیمی را حذف کنید.");
    this.name = "DiscountLimitError";
  }
}
