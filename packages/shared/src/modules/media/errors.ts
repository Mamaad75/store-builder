export type MediaValidationCode =
  | "empty"
  | "too_large"
  | "unsupported_format"
  | "corrupt"
  | "animated"
  | "too_many_pixels"
  | "output_too_large";

/** Fixed Persian messages: no internal detail (library errors, paths) ever reaches the user. */
export const MEDIA_VALIDATION_MESSAGES: Record<MediaValidationCode, string> = {
  empty: "فایلی انتخاب نشده است.",
  too_large: "حجم فایل بیش از ۵ مگابایت است.",
  unsupported_format: "فقط تصویر JPEG، PNG یا WebP مجاز است.",
  corrupt: "فایل تصویر معتبر نیست یا آسیب دیده است.",
  animated: "تصویرهای متحرک مجاز نیستند.",
  too_many_pixels: "ابعاد تصویر بیش از حد بزرگ است (حداکثر ۲۵ مگاپیکسل).",
  output_too_large: "تصویر پس از پردازش هم بیش از حد بزرگ است.",
};

export class MediaValidationError extends Error {
  constructor(public readonly code: MediaValidationCode) {
    super(MEDIA_VALIDATION_MESSAGES[code]);
    this.name = "MediaValidationError";
  }
}

export class MediaQuotaError extends Error {
  constructor(public readonly kind: "count" | "bytes") {
    super(`Media quota exceeded (${kind})`);
    this.name = "MediaQuotaError";
  }
}

export class MediaInUseError extends Error {
  constructor() {
    super("Media is still referenced");
    this.name = "MediaInUseError";
  }
}

export class MediaRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Upload rate limit exceeded");
    this.name = "MediaRateLimitError";
  }
}

/** The object store failed; the database was left consistent (see the consistency strategy in docs/media.md). */
export class MediaStorageError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Object storage operation failed", options);
    this.name = "MediaStorageError";
  }
}
