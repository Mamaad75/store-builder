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
  constructor(public readonly reason: "off" | "amount" | "no_cards") {
    super(
      reason === "amount"
        ? "مبلغ این سفارش در محدوده‌ی پرداخت این درگاه نیست؛ درگاه یا روش پرداخت دیگری را انتخاب کنید."
        : reason === "no_cards"
          ? "پرداخت کارت به کارت در این فروشگاه فعال نیست."
          : "پرداخت اینترنتی در این فروشگاه فعال نیست.",
    );
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

/** D35b-1: a receipt cannot be sent now (order not waiting for one, one already under review, or too many). */
export class ReceiptNotAllowedError extends Error {
  constructor(public readonly reason: "closed" | "pending" | "too_many" = "closed") {
    super(
      reason === "pending"
        ? "رسید قبلی شما در حال بررسی فروشگاه است."
        : reason === "too_many"
          ? "تعداد رسیدهای این سفارش به حداکثر رسیده است؛ با فروشگاه تماس بگیرید."
          : "این سفارش در حال حاضر رسید نمی‌پذیرد.",
    );
    this.name = "ReceiptNotAllowedError";
  }
}
