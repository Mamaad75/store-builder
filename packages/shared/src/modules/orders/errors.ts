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

/** Phase 3.5: online payment is not available for this store (off on the platform, or no merchant id), or not for this amount. */
export class PaymentUnavailableError extends Error {
  constructor(public readonly reason: "off" | "amount") {
    super(reason === "amount" ? "پرداخت اینترنتی برای مبلغ بیش از ۱۰۰ میلیون تومان ممکن نیست؛ پرداخت در محل را انتخاب کنید." : "پرداخت اینترنتی در این فروشگاه فعال نیست.");
    this.name = "PaymentUnavailableError";
  }
}

/** Phase 3.5: the payment gateway could not be reached or refused the request (nothing about the provider is shown). */
export class PaymentGatewayError extends Error {
  constructor() {
    super("ارتباط با درگاه پرداخت برقرار نشد؛ کمی بعد دوباره تلاش کنید.");
    this.name = "PaymentGatewayError";
  }
}

/** Phase 3.5: the order cannot be paid now (already paid, cancelled, expired, or too many attempts). */
export class PaymentNotAllowedError extends Error {
  constructor(public readonly reason: "closed" | "busy" = "closed") {
    super(reason === "busy" ? "پرداخت این سفارش در حال تأیید است؛ چند دقیقه بعد دوباره ببینید." : "این سفارش در حال حاضر قابل پرداخت نیست.");
    this.name = "PaymentNotAllowedError";
  }
}
