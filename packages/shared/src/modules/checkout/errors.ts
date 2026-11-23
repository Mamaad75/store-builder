/** Checkout errors (phase 3.3). */

/** The cart already has MAX_CART_LINES distinct lines. */
export class CartLimitError extends Error {
  constructor(public readonly limit: number) {
    super("سبد خرید پر است؛ برای افزودن کالای تازه، کالایی را از سبد بردارید.");
    this.name = "CartLimitError";
  }
}

/** The customer already has MAX_ADDRESSES_PER_CUSTOMER addresses. */
export class AddressLimitError extends Error {
  constructor(public readonly limit: number) {
    super("تعداد نشانی‌های ذخیره‌شده به سقف رسیده است؛ یکی را حذف کنید.");
    this.name = "AddressLimitError";
  }
}

/** Too many new carts from one network in a short time (anonymous writes are bounded). */
export class CartRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("درخواست‌های زیادی از این شبکه رسیده است؛ کمی بعد دوباره تلاش کنید.");
    this.name = "CartRateLimitedError";
  }
}
