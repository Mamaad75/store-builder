/** Customer sign-in errors (phase 3.1). Messages are fixed Persian text; nothing in them depends on whether a phone is known. */
export class OtpUnavailableError extends Error {
  constructor() {
    super("ورود با پیامک هنوز فعال نشده است.");
    this.name = "OtpUnavailableError";
  }
}

export class OtpRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("تعداد درخواست کد زیاد است؛ کمی بعد دوباره امتحان کنید.");
    this.name = "OtpRateLimitedError";
  }
}

/** The SMS provider did not accept the code (nothing about the provider is shown). */
export class OtpDeliveryError extends Error {
  constructor() {
    super("ارسال پیامک ممکن نشد؛ کمی بعد دوباره امتحان کنید.");
    this.name = "OtpDeliveryError";
  }
}

/** Wrong, expired, already used or exhausted code: one answer for all of them. */
export class OtpInvalidError extends Error {
  constructor() {
    super("کد واردشده نادرست است یا منقضی شده است.");
    this.name = "OtpInvalidError";
  }
}

/** Phase 3.3b: wrong phone or password — one answer for both (no hint whether the phone has an account). */
export class CustomerLoginError extends Error {
  constructor() {
    super("شماره‌ی موبایل یا رمز عبور نادرست است.");
    this.name = "CustomerLoginError";
  }
}

/**
 * Registering a phone that already has an account with a password, or whose owner already verified it by SMS code: sign in instead.
 * (Setting a password on a verified account would let anyone who types the number take it over.)
 */
export class CustomerExistsError extends Error {
  constructor() {
    super("با این شماره قبلاً ثبت‌نام شده است؛ وارد شوید.");
    this.name = "CustomerExistsError";
  }
}

/** Too many password attempts for this phone or network. */
export class CustomerLoginRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("تلاش‌های زیادی انجام شده است؛ کمی بعد دوباره امتحان کنید.");
    this.name = "CustomerLoginRateLimitedError";
  }
}
