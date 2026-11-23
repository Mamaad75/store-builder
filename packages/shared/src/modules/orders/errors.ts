/** Order errors (phase 3.4). */

/** The checkout is not complete (empty cart, a line that cannot be bought, no shipping for the address, ...). Nothing was ordered. */
export class OrderNotReadyError extends Error {
  constructor(public readonly blockers: string[]) {
    super("سفارش هنوز کامل نیست؛ موارد خواسته‌شده را اصلاح کنید.");
    this.name = "OrderNotReadyError";
  }
}

/** The order cannot move to that status from where it is now (or not by this actor). Nothing changed. */
export class OrderTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super("وضعیت این سفارش را نمی‌توان به این شکل تغییر داد.");
    this.name = "OrderTransitionError";
  }
}

/** Too many orders from one network or one phone in a short time. */
export class OrderRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("سفارش‌های زیادی در مدت کوتاه ثبت شده است؛ کمی بعد دوباره تلاش کنید.");
    this.name = "OrderRateLimitedError";
  }
}
