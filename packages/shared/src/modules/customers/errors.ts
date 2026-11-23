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
